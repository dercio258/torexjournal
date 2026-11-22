import React, { useState, useEffect, useRef } from 'react';
import {
    Shield,
    User,
    CheckCircle2,
    Camera,
    Upload,
    RefreshCw,
    Trash2,
    AlertCircle,
    X,
    Eye,
    EyeOff,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { AiMemoryCard } from '../components/ai/AiMemoryCard';
import { LanguageSwitcher } from '../components/ui/LanguageSwitcher';
import { ConfigurationSkeleton } from '../components/ui/Skeleton';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import api from '../api';
import {
    updateUserContactOfflineAware,
    updateUserProfileOfflineAware,
} from '../services/offlineMutations';

interface UserProfile {
    id: string;
    name: string;
    username?: string;
    email: string;
    avatarUrl?: string | null;
    whatsapp?: string;
    token?: string;
    is_connected: boolean;
    role?: string;
    twoFactorEnabled: boolean;
    dailyLossLimit?: number;
}

const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];

export const Configuration = () => {
    const { user: authUser, updateUser, refreshProfile } = useAuth();
    const { locale } = useLocale();
    const isEn = locale === 'en';
    const [user, setUser] = useState<UserProfile | null>(() =>
        authUser
            ? {
                  id: authUser.id,
                  name: authUser.name || authUser.username || '',
                  username: authUser.username,
                  email: authUser.email,
                  avatarUrl: authUser.avatarUrl,
                  whatsapp: authUser.whatsapp || '',
                  is_connected: Boolean(authUser.is_connected),
                  twoFactorEnabled: Boolean(authUser.twoFactorEnabled),
              }
            : null
    );
    const [isLoading, setIsLoading] = useState(() => !authUser);

    const [show2FASetup, setShow2FASetup] = useState(false);
    const [qrCode, setQrCode] = useState('');
    const [otpCode, setOtpCode] = useState('');
    const [show2FADisable, setShow2FADisable] = useState(false);
    const [disable2faCode, setDisable2faCode] = useState('');
    const [disable2faPassword, setDisable2faPassword] = useState('');
    const [isDisabling2fa, setIsDisabling2fa] = useState(false);

    // Avatar upload / replace / delete states
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
    const [isDeletingAvatar, setIsDeletingAvatar] = useState(false);
    const [confirmDeleteAvatar, setConfirmDeleteAvatar] = useState(false);
    const [isDraggingOver, setIsDraggingOver] = useState(false);
    const [avatarLoadError, setAvatarLoadError] = useState(false);

    // WhatsApp contact edit state
    const [isEditingWhatsapp, setIsEditingWhatsapp] = useState(false);
    const [whatsappInput, setWhatsappInput] = useState('');
    const [isSavingWhatsapp, setIsSavingWhatsapp] = useState(false);

    // Ephemeral unmasked PII reveal state (never persisted to storage)
    const [isSensitiveRevealed, setIsSensitiveRevealed] = useState(false);
    const [isLoadingSensitive, setIsLoadingSensitive] = useState(false);
    const [sensitiveData, setSensitiveData] = useState<{ email: string; whatsapp: string } | null>(null);

    // Feedback banners
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const notifySuccess = (msg: string) => {
        setErrorMessage(null);
        setSuccessMessage(msg);
        setTimeout(() => {
            setSuccessMessage((prev) => (prev === msg ? null : prev));
        }, 4000);
    };

    const notifyError = (msg: string) => {
        setSuccessMessage(null);
        setErrorMessage(msg);
        setTimeout(() => {
            setErrorMessage((prev) => (prev === msg ? null : prev));
        }, 5000);
    };

    useEffect(() => {
        fetchUser();
    }, []);

    const fetchUser = async () => {
        try {
            const fresh = await refreshProfile();
            if (fresh) {
                setUser(fresh as unknown as UserProfile);
                setWhatsappInput(fresh.whatsapp || '');
                setAvatarLoadError(false);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    const currentAvatarUrl =
        !avatarLoadError && (user?.avatarUrl ?? authUser?.avatarUrl)
            ? (user?.avatarUrl ?? authUser?.avatarUrl)
            : null;

    const initials = (() => {
        const source = user?.name?.trim() || user?.username?.trim() || authUser?.username?.trim() || 'TR';
        const parts = source.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) {
            return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        }
        return source.substring(0, 2).toUpperCase();
    })();

    const processAvatarFile = async (file: File) => {
        if (!ALLOWED_IMAGE_TYPES.includes(file.type.toLowerCase())) {
            notifyError(
                isEn
                    ? 'Invalid format. Upload a JPG, PNG, WEBP, or GIF image.'
                    : 'Formato inválido. Envie uma imagem JPG, PNG, WEBP ou GIF.'
            );
            return;
        }

        if (file.size > MAX_AVATAR_SIZE_BYTES) {
            notifyError(
                isEn
                    ? 'Selected image exceeds the 5MB maximum size.'
                    : 'A imagem selecionada excede o tamanho máximo de 5MB.'
            );
            return;
        }

        const hadPreviousAvatar = Boolean(currentAvatarUrl);
        setIsUploadingAvatar(true);
        setConfirmDeleteAvatar(false);

        try {
            const formData = new FormData();
            formData.append('file', file);

            const res = await api.post('/auth/profile/avatar', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });

            const newAvatarUrl: string = res.data?.avatarUrl;
            setAvatarLoadError(false);
            setUser((prev) => (prev ? { ...prev, avatarUrl: newAvatarUrl } : prev));
            updateUser({ avatarUrl: newAvatarUrl });

            notifySuccess(
                hadPreviousAvatar
                    ? isEn
                        ? 'Profile photo replaced successfully!'
                        : 'Foto de perfil substituída com sucesso!'
                    : isEn
                      ? 'Profile photo uploaded successfully!'
                      : 'Foto de perfil enviada com sucesso!'
            );
        } catch (err: any) {
            console.error('Error uploading avatar:', err);
            notifyError(err.response?.data?.message || (isEn ? 'Error uploading profile photo.' : 'Erro ao enviar foto de perfil.'));
        } finally {
            setIsUploadingAvatar(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        processAvatarFile(file);
    };

    const handleDropAvatar = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingOver(false);
        if (isUploadingAvatar || isDeletingAvatar) return;

        const file = e.dataTransfer.files?.[0];
        if (file) {
            processAvatarFile(file);
        }
    };

    const handleDeleteAvatar = async () => {
        if (!currentAvatarUrl) return;
        setIsDeletingAvatar(true);
        try {
            await api.delete('/auth/profile/avatar');
            setAvatarLoadError(false);
            setConfirmDeleteAvatar(false);
            setUser((prev) => (prev ? { ...prev, avatarUrl: null } : prev));
            updateUser({ avatarUrl: null });
            notifySuccess(isEn ? 'Profile photo removed successfully!' : 'Foto de perfil removida com sucesso!');
        } catch (err: any) {
            console.error('Error deleting avatar:', err);
            notifyError(err.response?.data?.message || (isEn ? 'Error removing profile photo.' : 'Erro ao remover foto de perfil.'));
        } finally {
            setIsDeletingAvatar(false);
        }
    };

    const fetchSensitiveProfile = async (): Promise<{ email: string; whatsapp: string } | null> => {
        setIsLoadingSensitive(true);
        try {
            const res = await api.get('/auth/profile/sensitive');
            const next = {
                email: String(res.data?.email || ''),
                whatsapp: String(res.data?.whatsapp || ''),
            };
            setSensitiveData(next);
            return next;
        } catch (err: any) {
            notifyError(
                err?.response?.data?.message ||
                    (isEn
                        ? 'Could not load complete personal details right now.'
                        : 'Não foi possível revelar os dados completos agora.')
            );
            return null;
        } finally {
            setIsLoadingSensitive(false);
        }
    };

    const handleToggleSensitiveReveal = async () => {
        if (isSensitiveRevealed) {
            setIsSensitiveRevealed(false);
            setSensitiveData(null);
            return;
        }
        const loaded = await fetchSensitiveProfile();
        if (loaded) {
            setIsSensitiveRevealed(true);
        }
    };

    const handleSaveWhatsapp = async () => {
        setIsSavingWhatsapp(true);
        try {
            const res = await updateUserContactOfflineAware({ whatsapp: whatsappInput.trim() });
            const nextWhatsapp = res?.data?.whatsapp ?? whatsappInput.trim();
            setUser((prev) => (prev ? { ...prev, whatsapp: nextWhatsapp } : prev));
            if (res?.data?.whatsapp) {
                updateUser({ whatsapp: res.data.whatsapp });
            }
            setSensitiveData(null);
            setIsSensitiveRevealed(false);
            setIsEditingWhatsapp(false);
            notifySuccess(isEn ? 'Mobile contact updated successfully!' : 'Contacto móvel atualizado com sucesso!');
        } catch (err: any) {
            console.error('Error updating mobile contact:', err);
            notifyError(err.response?.data?.message || (isEn ? 'Error updating contact.' : 'Erro ao atualizar contacto.'));
        } finally {
            setIsSavingWhatsapp(false);
        }
    };

    const handleToggle2FA = async () => {
        if (!user) return;

        if (!user.twoFactorEnabled) {
            setShow2FADisable(false);
            try {
                const res = await api.post('/auth/2fa/setup');
                setQrCode(res.data.qrCodeDataUrl);
                setShow2FASetup(true);
            } catch (err) {
                console.error('Error starting 2FA setup:', err);
                notifyError(isEn ? 'Error starting 2FA setup.' : 'Erro ao iniciar configuração de 2FA.');
            }
        } else {
            setShow2FASetup(false);
            setShow2FADisable((prev) => !prev);
        }
    };

    const handleConfirmDisable2FA = async () => {
        if (!user) return;
        const cleanCode = disable2faCode.trim();
        if (!cleanCode && !disable2faPassword) {
            notifyError(
                isEn
                    ? 'Enter your 6-digit 2FA code or current password to disable 2FA.'
                    : 'Informe o código 2FA de 6 dígitos ou sua senha atual para desativar.'
            );
            return;
        }
        setIsDisabling2fa(true);
        try {
            await api.put('/auth/2fa', {
                enabled: false,
                code: cleanCode || undefined,
                password: disable2faPassword || undefined,
            });
            setUser({ ...user, twoFactorEnabled: false });
            updateUser({ twoFactorEnabled: false } as any);
            setShow2FADisable(false);
            setDisable2faCode('');
            setDisable2faPassword('');
            notifySuccess(isEn ? 'Two-factor authentication disabled.' : 'Autenticação de dois fatores desativada.');
        } catch (err: any) {
            console.error('Error disabling 2FA:', err);
            notifyError(
                err?.response?.data?.message ||
                    (isEn ? 'Invalid code or password.' : 'Código ou senha inválidos para desativar 2FA.')
            );
        } finally {
            setIsDisabling2fa(false);
        }
    };

    const handleVerifySetup = async () => {
        try {
            await api.post('/auth/2fa/verify-setup', { token: otpCode });
            setUser((prev) => (prev ? { ...prev, twoFactorEnabled: true } : null));
            setShow2FASetup(false);
            setOtpCode('');
            notifySuccess(isEn ? '2FA enabled successfully!' : '2FA ativado com sucesso!');
        } catch (err) {
            console.error('Error verifying 2FA setup:', err);
            notifyError(isEn ? 'Invalid verification code. Please try again.' : 'Código inválido. Tente novamente.');
        }
    };

    if (isLoading) {
        return <ConfigurationSkeleton />;
    }

    const isBusyAvatar = isUploadingAvatar || isDeletingAvatar;

    return (
        <div className="w-full space-y-3 pb-10">
            {/* Feedback Alerts */}
            {successMessage && (
                <div className="px-4 py-3 rounded-xl bg-accent/10 border border-accent/25 text-accent-fg text-xs sm:text-sm flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>{successMessage}</span>
                    </div>
                    <button
                        type="button"
                        onClick={() => setSuccessMessage(null)}
                        className="text-accent-fg/80 hover:text-accent-fg"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}

            {errorMessage && (
                <div className="px-4 py-3 rounded-xl bg-danger/10 border border-danger/25 text-danger-fg text-xs sm:text-sm flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>{errorMessage}</span>
                    </div>
                    <button
                        type="button"
                        onClick={() => setErrorMessage(null)}
                        className="text-danger-fg/80 hover:text-danger-fg"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
                {/* User Info & Risk Management */}
                <Card className="lg:col-span-7 space-y-5">
                    <div className="flex items-center justify-between pb-3 border-b border-line-subtle">
                        <h2 className="text-xs font-bold text-fg uppercase tracking-wider flex items-center gap-2">
                            <User className="w-4 h-4 text-accent-fg" />
                            <span>{isEn ? 'User Information' : 'Informações do Usuário'}</span>
                        </h2>
                        <span className="px-2 py-0.5 bg-accent/10 text-accent-fg text-[10px] font-bold uppercase rounded border border-accent/25">
                            {user?.role || 'Trader'}
                        </span>
                    </div>

                    <div className="space-y-4">
                        {/* Foto de Perfil: Upload, Substituir e Apagar */}
                        <div
                            onDragOver={(e) => {
                                e.preventDefault();
                                if (!isBusyAvatar) setIsDraggingOver(true);
                            }}
                            onDragLeave={() => setIsDraggingOver(false)}
                            onDrop={handleDropAvatar}
                            className={`p-3.5 sm:p-4 rounded-xl border transition-colors ${
                                isDraggingOver
                                    ? 'bg-accent/10 border-accent/50'
                                    : 'bg-canvas-subtle border-line-subtle'
                            }`}
                        >
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
                                <div className="flex items-center gap-3.5 min-w-0">
                                    <button
                                        type="button"
                                        disabled={isBusyAvatar}
                                        onClick={() => fileInputRef.current?.click()}
                                        title={
                                            currentAvatarUrl
                                                ? (isEn ? 'Click to replace profile photo' : 'Clique para substituir a foto de perfil')
                                                : (isEn ? 'Click to upload profile photo' : 'Clique para enviar uma foto de perfil')
                                        }
                                        className="relative w-16 h-16 rounded-full bg-surface-2 border-2 border-line-strong ring-2 ring-accent/30 text-accent-fg font-bold text-lg flex items-center justify-center shrink-0 overflow-hidden group cursor-pointer focus:outline-none disabled:cursor-not-allowed"
                                    >
                                        {currentAvatarUrl ? (
                                            <img
                                                src={currentAvatarUrl}
                                                alt={user?.name || (isEn ? 'Profile photo' : 'Foto de perfil')}
                                                onError={() => setAvatarLoadError(true)}
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <span className="tracking-tight select-none">{initials}</span>
                                        )}

                                        {isBusyAvatar ? (
                                            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                                <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                                            </div>
                                        ) : (
                                            <div className="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                <Camera className="w-4 h-4 text-white" />
                                            </div>
                                        )}
                                    </button>

                                    <div className="min-w-0 space-y-0.5">
                                        <p className="text-xs sm:text-sm font-bold text-fg">
                                            {isEn ? 'Profile Photo' : 'Foto de Perfil'}
                                        </p>
                                        <p className="text-[11px] text-fg-muted leading-relaxed">
                                            {isDraggingOver
                                                ? (isEn ? 'Drop the image here to update your profile.' : 'Solte a imagem aqui para atualizar seu perfil.')
                                                : currentAvatarUrl
                                                  ? (isEn ? 'Replace with another image or remove current photo.' : 'Substitua por outra imagem ou apague a foto atual.')
                                                  : (isEn ? 'Upload an image or drag and drop here.' : 'Faça upload de uma imagem ou arraste e solte aqui.')}
                                        </p>
                                        <p className="text-[10px] text-fg-subtle">
                                            {isEn ? 'JPG, PNG, WEBP or GIF • Max 5MB' : 'JPG, PNG, WEBP ou GIF • Máx. 5MB'}
                                        </p>
                                    </div>
                                </div>

                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp,image/gif"
                                    onChange={handleFileSelect}
                                    className="hidden"
                                />

                                <div className="flex flex-wrap items-center gap-2 shrink-0">
                                    {!currentAvatarUrl ? (
                                        <button
                                            type="button"
                                            disabled={isBusyAvatar}
                                            onClick={() => fileInputRef.current?.click()}
                                            className="inline-flex items-center justify-center gap-1.5 h-8 px-3.5 rounded-lg bg-accent hover:opacity-95 disabled:opacity-50 text-accent-on text-xs font-semibold transition-opacity cursor-pointer"
                                        >
                                            <Upload className="w-3.5 h-3.5" />
                                            <span>{isUploadingAvatar ? (isEn ? 'Uploading...' : 'Enviando...') : (isEn ? 'Upload Photo' : 'Fazer Upload')}</span>
                                        </button>
                                    ) : confirmDeleteAvatar ? (
                                        <>
                                            <button
                                                type="button"
                                                disabled={isBusyAvatar}
                                                onClick={handleDeleteAvatar}
                                                className="inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg bg-danger/15 hover:bg-danger/25 border border-danger/35 text-danger-fg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                                <span>{isDeletingAvatar ? (isEn ? 'Deleting...' : 'Apagando...') : (isEn ? 'Confirm Removal' : 'Confirmar Exclusão')}</span>
                                            </button>
                                            <button
                                                type="button"
                                                disabled={isBusyAvatar}
                                                onClick={() => setConfirmDeleteAvatar(false)}
                                                className="inline-flex items-center justify-center h-8 px-3 rounded-lg bg-surface-2 hover:bg-surface-3 border border-line text-fg-muted hover:text-fg text-xs font-semibold transition-colors cursor-pointer"
                                            >
                                                {isEn ? 'Cancel' : 'Cancelar'}
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <button
                                                type="button"
                                                disabled={isBusyAvatar}
                                                onClick={() => fileInputRef.current?.click()}
                                                className="inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg bg-surface-2 hover:bg-surface-3 disabled:opacity-50 border border-line text-fg text-xs font-semibold transition-colors cursor-pointer"
                                            >
                                                <RefreshCw
                                                    className={`w-3.5 h-3.5 ${isUploadingAvatar ? 'animate-spin' : ''}`}
                                                />
                                                <span>{isUploadingAvatar ? (isEn ? 'Replacing...' : 'Substituindo...') : (isEn ? 'Replace' : 'Substituir')}</span>
                                            </button>
                                            <button
                                                type="button"
                                                disabled={isBusyAvatar}
                                                onClick={() => setConfirmDeleteAvatar(true)}
                                                className="inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg bg-danger/10 hover:bg-danger/20 disabled:opacity-50 border border-danger/25 text-danger-fg text-xs font-semibold transition-colors cursor-pointer"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                                <span>{isEn ? 'Remove' : 'Apagar'}</span>
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] uppercase font-bold text-fg-subtle">
                                {isEn ? 'Personal Contact Details' : 'Dados Pessoais'}
                            </span>
                            <button
                                type="button"
                                disabled={isLoadingSensitive}
                                onClick={() => void handleToggleSensitiveReveal()}
                                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-accent-fg hover:underline disabled:opacity-50 cursor-pointer"
                            >
                                {isSensitiveRevealed ? (
                                    <EyeOff className="w-3.5 h-3.5" />
                                ) : (
                                    <Eye className="w-3.5 h-3.5" />
                                )}
                                <span>
                                    {isLoadingSensitive
                                        ? isEn
                                            ? 'Loading...'
                                            : 'Carregando...'
                                        : isSensitiveRevealed
                                          ? isEn
                                              ? 'Hide sensitive data'
                                              : 'Ocultar dados'
                                          : isEn
                                            ? 'Show full details'
                                            : 'Mostrar dados completos'}
                                </span>
                            </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                            <div>
                                <label className="text-[10px] uppercase font-bold text-fg-subtle mb-1 block">
                                    {isEn ? 'Full Name' : 'Nome Completo'}
                                </label>
                                <input
                                    disabled
                                    value={user?.name || ''}
                                    className="w-full h-9 bg-canvas-subtle border border-line rounded-lg px-3 text-xs sm:text-sm text-fg-muted focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-bold text-fg-subtle mb-1 block">
                                    Email
                                </label>
                                <input
                                    disabled
                                    value={
                                        isSensitiveRevealed && sensitiveData
                                            ? sensitiveData.email
                                            : user?.email || ''
                                    }
                                    className="w-full h-9 bg-canvas-subtle border border-line rounded-lg px-3 text-xs sm:text-sm text-fg-muted focus:outline-none"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="text-[10px] uppercase font-bold text-fg-subtle mb-1 block">
                                {isEn ? 'Mobile Contact' : 'Contacto Móvel'}
                            </label>
                            <div className="flex gap-2">
                                <input
                                    disabled={!isEditingWhatsapp}
                                    value={
                                        isEditingWhatsapp
                                            ? whatsappInput
                                            : isSensitiveRevealed && sensitiveData
                                              ? sensitiveData.whatsapp
                                              : user?.whatsapp || ''
                                    }
                                    onChange={(e) => setWhatsappInput(e.target.value)}
                                    className={`flex-1 h-9 bg-canvas-subtle border rounded-lg px-3 text-xs sm:text-sm focus:outline-none ${
                                        isEditingWhatsapp
                                            ? 'border-accent/60 text-fg'
                                            : 'border-line text-fg-muted'
                                    }`}
                                    placeholder={isEn ? 'Not provided' : 'Não informado'}
                                />
                                {isEditingWhatsapp ? (
                                    <>
                                        <button
                                            type="button"
                                            disabled={isSavingWhatsapp}
                                            onClick={handleSaveWhatsapp}
                                            className="h-9 px-3.5 bg-accent hover:opacity-95 disabled:opacity-50 text-accent-on text-xs font-semibold rounded-lg transition-opacity"
                                        >
                                            {isSavingWhatsapp ? (isEn ? 'Saving...' : 'Salvando...') : (isEn ? 'Save' : 'Salvar')}
                                        </button>
                                        <button
                                            type="button"
                                            disabled={isSavingWhatsapp}
                                            onClick={() => {
                                                setIsEditingWhatsapp(false);
                                                setWhatsappInput('');
                                            }}
                                            className="h-9 px-3 bg-surface-2 hover:bg-surface-3 border border-line text-fg-muted hover:text-fg text-xs font-semibold rounded-lg transition-colors"
                                        >
                                            {isEn ? 'Cancel' : 'Cancelar'}
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        type="button"
                                        disabled={isLoadingSensitive}
                                        onClick={async () => {
                                            const revealed = sensitiveData ?? (await fetchSensitiveProfile());
                                            if (!revealed) return;
                                            setWhatsappInput(revealed.whatsapp || '');
                                            setIsEditingWhatsapp(true);
                                        }}
                                        className="h-9 px-3.5 bg-surface-2 hover:bg-surface-3 border border-line text-fg text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
                                    >
                                        {isEn ? 'Edit' : 'Editar'}
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Language & Regional Preferences */}
                        <div className="pt-4 border-t border-line-subtle flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
                            <div>
                                <label className="text-[10px] uppercase font-bold text-fg-subtle block">
                                    {isEn ? 'Platform Language' : 'Idioma da Plataforma'}
                                </label>
                                <p className="text-[11px] text-fg-muted mt-0.5">
                                    {isEn ? (
                                        <>Switch manually between Portuguese (<code>/</code>) and English (<code>/en</code>).</>
                                    ) : (
                                        <>Alterne manualmente entre Português (<code>/</code>) e Inglês (<code>/en</code>).</>
                                    )}
                                </p>
                            </div>
                            <LanguageSwitcher variant="pill" />
                        </div>

                        {/* Risk Management */}
                        <div className="pt-4 border-t border-line-subtle space-y-2.5">
                            <label className="text-[10px] uppercase font-bold text-fg-subtle block">
                                {isEn ? 'Risk Management' : 'Gerenciamento de Risco'}
                            </label>
                            <div className="flex flex-col sm:flex-row gap-2.5 sm:items-end">
                                <div className="flex-1">
                                    <p className="text-xs text-fg-muted mb-1.5">
                                        {isEn ? 'Daily Loss Limit (MT5)' : 'Limite de Perda Diária (MT)'}
                                    </p>
                                    <input
                                        type="number"
                                        placeholder="0.00"
                                        value={user?.dailyLossLimit ?? ''}
                                        onChange={(e) =>
                                            setUser((prev) =>
                                                prev
                                                    ? {
                                                          ...prev,
                                                          dailyLossLimit:
                                                              e.target.value === ''
                                                                  ? undefined
                                                                  : parseFloat(e.target.value),
                                                      }
                                                    : null
                                            )
                                        }
                                        className="w-full h-9 bg-canvas-subtle border border-line rounded-lg px-3 text-xs sm:text-sm font-mono tabular-nums text-fg focus:border-accent/60 outline-none"
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={async () => {
                                        try {
                                            await updateUserProfileOfflineAware({
                                                dailyLossLimit: user?.dailyLossLimit ?? null,
                                            });
                                            notifySuccess(isEn ? 'Risk guardrails updated!' : 'Configurações de risco atualizadas!');
                                        } catch {
                                            notifyError(isEn ? 'Error saving risk settings.' : 'Erro ao salvar configurações de risco.');
                                        }
                                    }}
                                    className="h-9 px-4 bg-accent hover:opacity-95 text-accent-on text-xs font-semibold rounded-lg transition-opacity shrink-0"
                                >
                                    {isEn ? 'Save Limit' : 'Gravar Limite'}
                                </button>
                            </div>
                            <p className="text-[11px] text-fg-subtle">
                                {isEn
                                    ? 'You will receive an E-mail & In-App security alert as soon as your daily drawdown hits this threshold.'
                                    : 'Você receberá um alerta por E-mail e na Central de Notificações assim que sua perda diária atingir este valor.'}
                            </p>
                        </div>
                    </div>
                </Card>

                {/* Right Column: Security & AI Memory */}
                <div className="lg:col-span-5 space-y-3">
                    {/* Security Card */}
                    <Card className="space-y-4">
                        <div className="flex items-center gap-2 pb-3 border-b border-line-subtle">
                            <Shield className="w-4 h-4 text-accent-fg" />
                            <h2 className="text-xs font-bold text-fg uppercase tracking-wider">
                                {isEn ? 'Security' : 'Segurança'}
                            </h2>
                        </div>

                        <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-canvas-subtle border border-line-subtle">
                            <div>
                                <p className="text-xs sm:text-sm font-bold text-fg">
                                    {isEn ? '2FA Authentication' : 'Autenticação 2FA'}
                                </p>
                                <p className="text-[11px] text-fg-muted mt-0.5">
                                    {isEn
                                        ? 'Protect your account with TOTP authenticator codes.'
                                        : 'Proteja sua conta com código autenticador TOTP.'}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={handleToggle2FA}
                                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none ${
                                    user?.twoFactorEnabled ? 'bg-accent' : 'bg-surface-3'
                                }`}
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                        user?.twoFactorEnabled ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                                />
                            </button>
                        </div>

                        <div
                            className={`p-3 rounded-lg text-xs leading-relaxed border ${
                                user?.twoFactorEnabled
                                    ? 'bg-accent/10 text-accent-fg border-accent/25'
                                    : 'bg-canvas-subtle text-fg-muted border-line-subtle'
                            }`}
                        >
                            {user?.twoFactorEnabled
                                ? isEn
                                    ? 'Your account is protected with Google Authenticator or a compatible app.'
                                    : 'Sua conta está protegida com Google Authenticator ou similar.'
                                : isEn
                                  ? 'Enable two-factor authentication to strengthen account security.'
                                  : 'Ative a autenticação de dois fatores para aumentar a segurança da sua conta.'}
                        </div>

                        {show2FASetup && (
                            <div className="p-3.5 bg-canvas-subtle rounded-xl border border-line space-y-3">
                                <p className="text-xs font-bold text-fg uppercase">
                                    {isEn ? 'Set Up 2FA' : 'Configurar 2FA'}
                                </p>
                                <p className="text-[11px] text-fg-muted">
                                    {isEn
                                        ? 'Scan the QR code below using your authenticator app.'
                                        : 'Escaneie o QR Code abaixo no seu aplicativo autenticador.'}
                                </p>

                                <div className="flex justify-center p-2 bg-white rounded-lg w-fit mx-auto">
                                    <img src={qrCode} alt="2FA QR Code" className="w-28 h-28" />
                                </div>

                                <div className="space-y-2">
                                    <label className="text-[10px] uppercase font-bold text-fg-subtle block">
                                        {isEn ? 'Verification Code' : 'Código de Verificação'}
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            value={otpCode}
                                            onChange={(e) => setOtpCode(e.target.value)}
                                            placeholder="000000"
                                            className="flex-1 h-9 bg-surface border border-line rounded-lg px-3 text-xs font-mono text-fg focus:outline-none focus:border-accent/60"
                                        />
                                        <button
                                            type="button"
                                            onClick={handleVerifySetup}
                                            className="h-9 px-3.5 bg-accent hover:opacity-95 text-accent-on text-xs font-semibold rounded-lg transition-opacity"
                                        >
                                            {isEn ? 'Verify' : 'Verificar'}
                                        </button>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setShow2FASetup(false)}
                                        className="w-full py-1.5 text-[11px] text-fg-subtle hover:text-fg"
                                    >
                                        {isEn ? 'Cancel' : 'Cancelar'}
                                    </button>
                                </div>
                            </div>
                        )}

                        {show2FADisable && user?.twoFactorEnabled && (
                            <div className="p-3.5 bg-canvas-subtle rounded-xl border border-danger/30 space-y-3">
                                <p className="text-xs font-bold text-fg uppercase">
                                    {isEn ? 'Confirm 2FA Deactivation' : 'Confirmar Desativação do 2FA'}
                                </p>
                                <p className="text-[11px] text-fg-muted">
                                    {isEn
                                        ? 'Enter your 6-digit authenticator code or current account password.'
                                        : 'Informe o código de 6 dígitos do autenticador ou sua senha atual.'}
                                </p>
                                <div className="space-y-2">
                                    <input
                                        value={disable2faCode}
                                        onChange={(e) => setDisable2faCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                        placeholder={isEn ? '6-digit code (optional if password)' : 'Código de 6 dígitos'}
                                        className="w-full h-9 bg-surface border border-line rounded-lg px-3 text-xs font-mono text-fg focus:outline-none focus:border-accent/60"
                                    />
                                    <input
                                        type="password"
                                        value={disable2faPassword}
                                        onChange={(e) => setDisable2faPassword(e.target.value)}
                                        placeholder={isEn ? 'Current password (or leave empty if code)' : 'Senha atual (opcional se código)'}
                                        className="w-full h-9 bg-surface border border-line rounded-lg px-3 text-xs text-fg focus:outline-none focus:border-accent/60"
                                    />
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            disabled={isDisabling2fa}
                                            onClick={handleConfirmDisable2FA}
                                            className="flex-1 h-9 px-3.5 bg-danger hover:opacity-95 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-opacity"
                                        >
                                            {isDisabling2fa
                                                ? isEn
                                                    ? 'Disabling...'
                                                    : 'Desativando...'
                                                : isEn
                                                  ? 'Disable 2FA'
                                                  : 'Desativar 2FA'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setShow2FADisable(false);
                                                setDisable2faCode('');
                                                setDisable2faPassword('');
                                            }}
                                            className="h-9 px-3 text-[11px] text-fg-subtle hover:text-fg rounded-lg border border-line"
                                        >
                                            {isEn ? 'Cancel' : 'Cancelar'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </Card>

                    <AiMemoryCard isEn={isEn} />
                </div>
            </div>
        </div>
    );
};
