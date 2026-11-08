import React from 'react';

export const WhatsAppSupportWidget: React.FC = () => {
    const phoneNumber = "258858923752";
    const message = encodeURIComponent("Olá, preciso de suporte no Torex Journal.");
    const whatsappUrl = `https://wa.me/${phoneNumber}?text=${message}`;

    return (
        <div className="fixed bottom-6 right-6 z-50 flex items-center group">
            {/* Tooltip on Hover */}
            <div className="absolute right-16 opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none translate-x-2 group-hover:translate-x-0 hidden sm:flex items-center gap-2 px-3.5 py-2 rounded-xl bg-canvas/95 border border-line-strong text-fg shadow-2xl backdrop-blur-md whitespace-nowrap">
                <div className="flex flex-col text-left">
                    <span className="text-xs font-bold text-fg">Suporte WhatsApp</span>
                    <span className="text-[11px] font-mono text-accent-fg font-semibold">+258 85 892 3752</span>
                </div>
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse ml-1" />
            </div>

            {/* WhatsApp Floating Button */}
            <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Contacto de WhatsApp Suporte"
                className="group relative flex items-center justify-center w-14 h-14 bg-[#25D366] hover:bg-[#20bd5a] text-white rounded-full shadow-lg shadow-emerald-900/40 hover:shadow-emerald-500/40 transition-all duration-300 hover:scale-110 active:scale-95"
            >
                {/* Subtle Pulse Animation */}
                <span className="absolute inset-0 rounded-full bg-[#25D366] opacity-30 animate-ping pointer-events-none" />

                {/* WhatsApp Vector Icon */}
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    width="28"
                    height="28"
                    fill="currentColor"
                    className="relative z-10 text-fg drop-shadow-sm"
                >
                    <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm.01 1.67c2.2 0 4.26.86 5.82 2.42a8.23 8.23 0 0 1 2.41 5.83c0 4.54-3.7 8.24-8.24 8.24-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24zm4.52 11.66c-.25-.13-1.47-.72-1.7-.81-.23-.08-.39-.13-.56.13-.17.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.13-1.06-.39-2.03-1.24-.75-.67-1.26-1.5-1.41-1.75-.15-.25-.02-.39.11-.51.11-.11.25-.29.38-.44.13-.14.17-.25.25-.42.08-.17.04-.31-.02-.44-.06-.13-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.44.06-.67.31-.23.25-.88.86-.88 2.1 0 1.24.9 2.44 1.03 2.61.13.17 1.78 2.72 4.31 3.81.6.26 1.07.42 1.44.53.61.2 1.16.17 1.6.1.49-.07 1.47-.6 1.68-1.19.2-.58.2-1.08.14-1.19-.06-.1-.23-.17-.48-.29z" />
                </svg>

                {/* Online Status Dot */}
                <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-emerald-400 border-2 border-slate-950 rounded-full shadow-sm" />
            </a>
        </div>
    );
};
