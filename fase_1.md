Fase	Foco	Entregas Principais
Fase 1 (Imediata)	Segurança, Credenciais & Proteção de Dados	1. Rotacionar senhas/chaves expostas e remover scripts com credenciais/PII do Git.
2. Neutralizar o DROP COLUMN em 1769260033286-InitialSchemaLoose.ts.
3. Corrigir isolamento MT5 Cloud (accountUuid + validação de senha antes de mapear conta), OAuth/2FA, AdminLayout + api.ts, sanitização XSS (DOMPurify), limpeza completa no logout() e autenticação no quant-engine.