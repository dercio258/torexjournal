export function getQuantAuthHeaders(
    extra: Record<string, string> = {},
): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    try {
        if (typeof localStorage !== 'undefined') {
            const token = localStorage.getItem('token')?.trim();
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
        }
    } catch {
        // ignore storage access restrictions
    }
    return headers;
}
