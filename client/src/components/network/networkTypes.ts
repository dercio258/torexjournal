export interface VideoLessonItem {
    id: string;
    title: string;
    description: string;
    embedInput: string;
    embedUrl: string;
    embedType: 'iframe' | 'video';
    thumbnailUrl?: string | null;
    category: string;
    durationLabel?: string | null;
    orderIndex: number;
    sequenceNumber?: number;
    isPublished: boolean;
    likesCount: number;
    commentsCount: number;
    viewsCount: number;
    isWatched?: boolean;
    watchedAt?: string | null;
    isLiked?: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface VideoLessonsSummary {
    totalLessons: number;
    watchedCount: number;
    lockedUnwatchedCount: number;
    completionPercent: number;
    nextUnwatchedLessonId: string | null;
}

export interface LessonCommentItem {
    id: string;
    lessonId: string;
    content: string;
    createdAt: string;
    user: {
        id: string;
        username: string;
        name?: string;
        avatarUrl?: string | null;
    };
}

export interface DirectConversationSummary {
    partner: {
        id: string;
        username: string;
        name?: string;
        avatarUrl?: string | null;
    };
    lastMessage: string;
    lastMessageAt: string;
    lastSenderId: string;
    unreadCount: number;
}

export interface DirectMessageItem {
    id: string;
    senderId: string;
    recipientId: string;
    content: string;
    isRead: boolean;
    createdAt: string;
}

/**
 * Faz parsing no cliente (ex.: preview ao vivo no painel Admin ou hover preview nos cards)
 */
export function parseClientEmbedPreview(rawInput: string): {
    embedUrl: string | null;
    embedType: 'iframe' | 'video';
    autoThumbnail: string | null;
} {
    const raw = String(rawInput || '').trim();
    if (!raw) {
        return { embedUrl: null, embedType: 'iframe', autoThumbnail: null };
    }

    let url = raw;
    if (/<iframe/i.test(raw)) {
        const match = raw.match(/src\s*=\s*["']([^"']+)["']/i);
        url = match?.[1]?.trim() || '';
    }
    if (url.startsWith('//')) {
        url = `https:${url}`;
    }
    if (!/^https?:\/\//i.test(url) && !url.startsWith('/uploads/')) {
        return { embedUrl: null, embedType: 'iframe', autoThumbnail: null };
    }

    if (
        /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url) ||
        url.startsWith('/uploads/')
    ) {
        return { embedUrl: url, embedType: 'video', autoThumbnail: null };
    }

    const ytMatch = url.match(
        /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i
    );
    if (ytMatch?.[1]) {
        const videoId = ytMatch[1];
        return {
            embedUrl: `https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1`,
            embedType: 'iframe',
            autoThumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        };
    }

    const vimeoMatch = url.match(
        /(?:vimeo\.com\/|player\.vimeo\.com\/video\/)(\d+)/i
    );
    if (vimeoMatch?.[1]) {
        return {
            embedUrl: `https://player.vimeo.com/video/${vimeoMatch[1]}`,
            embedType: 'iframe',
            autoThumbnail: null,
        };
    }

    const loomMatch = url.match(/loom\.com\/(?:share|embed)\/([a-zA-Z0-9]+)/i);
    if (loomMatch?.[1]) {
        return {
            embedUrl: `https://www.loom.com/embed/${loomMatch[1]}`,
            embedType: 'iframe',
            autoThumbnail: null,
        };
    }

    const driveMatch = url.match(/drive\.google\.com\/file\/d\/([^/]+)/i);
    if (driveMatch?.[1]) {
        return {
            embedUrl: `https://drive.google.com/file/d/${driveMatch[1]}/preview`,
            embedType: 'iframe',
            autoThumbnail: null,
        };
    }

    return { embedUrl: url, embedType: 'iframe', autoThumbnail: null };
}

/**
 * Constrói uma URL de preview silencioso para quando o utilizador passa o cursor sobre o card
 */
export function buildSilentHoverEmbedUrl(embedUrl: string): string {
    try {
        const u = new URL(embedUrl, window.location.origin);
        if (u.hostname.includes('youtube.com')) {
            u.searchParams.set('autoplay', '1');
            u.searchParams.set('mute', '1');
            u.searchParams.set('controls', '0');
            u.searchParams.set('playsinline', '1');
            u.searchParams.set('loop', '1');
            return u.toString();
        }
        if (u.hostname.includes('vimeo.com')) {
            u.searchParams.set('autoplay', '1');
            u.searchParams.set('muted', '1');
            u.searchParams.set('background', '1');
            return u.toString();
        }
        return embedUrl;
    } catch {
        return embedUrl;
    }
}
