from __future__ import annotations

from typing import Any

import torch
import torch.nn as nn

from .features import CAT_VOCAB_SIZES, CONT_FEATURE_NAMES
from .schemas import BEHAVIOR_CLASSES


DEFAULT_EMBEDDING_DIMS: dict[str, int] = {
    "session_idx": 8,
    "symbol_idx": 12,
    "strategy_idx": 12,
    "account_type_idx": 6,
    "exec_mode_idx": 4,
}


class TorexBehaviorNet(nn.Module):
    """Causal PyTorch GRU + Self-Attention + Bottleneck Autoencoder for trading behavior detection."""

    def __init__(
        self,
        cont_dim: int = len(CONT_FEATURE_NAMES),
        vocab_sizes: dict[str, int] | None = None,
        embed_dims: dict[str, int] | None = None,
        d_model: int = 96,
        num_classes: int = len(BEHAVIOR_CLASSES),
        bottleneck_dim: int = 12,
        dropout: float = 0.15,
    ) -> None:
        super().__init__()
        self.cont_dim = int(cont_dim)
        self.vocab_sizes = dict(vocab_sizes or CAT_VOCAB_SIZES)
        self.embed_dims = dict(embed_dims or DEFAULT_EMBEDDING_DIMS)
        self.d_model = int(d_model)
        self.num_classes = int(num_classes)
        self.bottleneck_dim = int(bottleneck_dim)
        self.dropout_rate = float(dropout)

        self.embeddings = nn.ModuleDict(
            {
                name: nn.Embedding(
                    num_embeddings=self.vocab_sizes[name],
                    embedding_dim=self.embed_dims[name],
                    padding_idx=0,
                )
                for name in ("session_idx", "symbol_idx", "strategy_idx", "account_type_idx", "exec_mode_idx")
            }
        )
        cat_total_dim = sum(self.embed_dims.values())

        self.cat_tower = nn.Sequential(
            nn.Linear(cat_total_dim, 48),
            nn.LayerNorm(48),
            nn.GELU(),
            nn.Dropout(dropout * 0.7),
        )
        self.cont_tower = nn.Sequential(
            nn.Linear(self.cont_dim, 64),
            nn.LayerNorm(64),
            nn.GELU(),
            nn.Dropout(dropout),
        )
        self.fusion_proj = nn.Sequential(
            nn.Linear(48 + 64, self.d_model),
            nn.LayerNorm(self.d_model),
            nn.GELU(),
        )

        self.gru = nn.GRU(
            input_size=self.d_model,
            hidden_size=self.d_model,
            num_layers=2,
            batch_first=True,
            bidirectional=False,
            dropout=dropout,
        )
        self.causal_attn = nn.MultiheadAttention(
            embed_dim=self.d_model,
            num_heads=4,
            dropout=dropout * 0.7,
            batch_first=True,
        )
        self.attn_norm = nn.LayerNorm(self.d_model)

        self.classifier_head = nn.Sequential(
            nn.Linear(self.d_model, 48),
            nn.GELU(),
            nn.Dropout(dropout * 0.7),
            nn.Linear(48, self.num_classes),
        )
        self.ae_encoder = nn.Sequential(
            nn.Linear(self.d_model, self.bottleneck_dim),
            nn.Tanh(),
        )
        self.ae_decoder = nn.Linear(self.bottleneck_dim, self.cont_dim)

    def get_config(self) -> dict[str, Any]:
        return {
            "cont_dim": self.cont_dim,
            "vocab_sizes": self.vocab_sizes,
            "embed_dims": self.embed_dims,
            "d_model": self.d_model,
            "num_classes": self.num_classes,
            "bottleneck_dim": self.bottleneck_dim,
            "dropout": self.dropout_rate,
        }

    def forward(
        self,
        cont_x: torch.Tensor,
        cat_x: torch.Tensor,
        valid_mask: torch.Tensor | None = None,
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        Args:
            cont_x: float32 tensor (B, T, cont_dim)
            cat_x: int64 tensor (B, T, 5) ordered as CAT_FEATURE_NAMES
            valid_mask: bool tensor (B, T), True for real steps, False for left-padding
        Returns:
            logits: (B, T, num_classes)
            recon_cont: (B, T, cont_dim)
            latent: (B, T, bottleneck_dim)
        """
        cat_order = ("session_idx", "symbol_idx", "strategy_idx", "account_type_idx", "exec_mode_idx")
        emb_parts = []
        for idx, name in enumerate(cat_order):
            max_idx = self.vocab_sizes[name] - 1
            clamped = torch.clamp(cat_x[:, :, idx], min=0, max=max_idx)
            emb_parts.append(self.embeddings[name](clamped))

        cat_vec = torch.cat(emb_parts, dim=-1)
        h_cat = self.cat_tower(cat_vec)
        h_cont = self.cont_tower(cont_x)
        h = self.fusion_proj(torch.cat([h_cont, h_cat], dim=-1))

        if valid_mask is not None:
            h = h * valid_mask.unsqueeze(-1).to(h.dtype)

        seq_out, _ = self.gru(h)

        seq_len = seq_out.size(1)
        causal_mask = torch.triu(
            torch.ones((seq_len, seq_len), dtype=torch.bool, device=seq_out.device),
            diagonal=1,
        )

        # Build safe attention bias so padded keys cannot leak and pad queries never receive NaN
        if valid_mask is not None:
            key_invalid = ~valid_mask.bool()  # (B, T)
            # Only block keys that are invalid; for padded query rows allow self-attention to avoid all-inf softmax
            attn_mask = causal_mask.unsqueeze(0).expand(seq_out.size(0), -1, -1).clone()
            attn_mask = attn_mask | key_invalid.unsqueeze(1)
            eye = torch.eye(seq_len, dtype=torch.bool, device=seq_out.device).unsqueeze(0)
            attn_mask = attn_mask & (~(eye & key_invalid.unsqueeze(-1)))
            num_heads = self.causal_attn.num_heads
            attn_mask_heads = attn_mask.repeat_interleave(num_heads, dim=0)
            attn_out, _ = self.causal_attn(
                seq_out,
                seq_out,
                seq_out,
                attn_mask=attn_mask_heads,
                need_weights=False,
            )
        else:
            attn_out, _ = self.causal_attn(
                seq_out,
                seq_out,
                seq_out,
                attn_mask=causal_mask,
                need_weights=False,
            )

        encoded = self.attn_norm(seq_out + attn_out)
        if valid_mask is not None:
            encoded = encoded * valid_mask.unsqueeze(-1).to(encoded.dtype)

        logits = self.classifier_head(encoded)
        latent = self.ae_encoder(encoded)
        recon_cont = self.ae_decoder(latent)
        return logits, recon_cont, latent
