
import { useLocation, useNavigate } from 'react-router-dom';
import { Download, ArrowLeft, Share2 } from 'lucide-react';
import { Button } from '../components/ui/Button';

export const EmotionalShare = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const { image, date } = location.state || {}; // Expect base64 image

    // If no context, redirect back
    if (!image) {
        navigate('/emotional');
        return null;
    }

    const handleDownload = () => {
        const link = document.createElement('a');
        link.href = image;
        link.download = `Torex_Mental_Log_${date || 'Capture'}.png`;
        link.click();
    };

    return (
        <div className="min-h-screen bg-canvas p-8 flex flex-col items-center">
            <header className="w-full max-w-4xl flex justify-between items-center mb-8">
                <button
                    onClick={() => navigate('/emotional')}
                    className="flex items-center gap-2 text-fg-muted hover:text-fg transition-colors"
                >
                    <ArrowLeft size={20} />
                    Voltar
                </button>
                <h1 className="text-2xl font-bold text-fg flex items-center gap-2">
                    <Share2 className="text-purple-400" />
                    Compartilhar Registro
                </h1>
                <div className="w-20"></div> {/* Spacer */}
            </header>

            <div className="w-full max-w-4xl bg-surface/50 p-6 rounded-2xl border border-line shadow-2xl flex flex-col items-center">
                <div className="bg-canvas p-4 rounded-xl border border-line mb-6">
                    <img src={image} alt="Mental Log Capture" className="max-w-full rounded-lg shadow-lg" />
                </div>

                <div className="flex gap-4 w-full justify-center">
                    <Button
                        onClick={handleDownload}
                        variant="gradient"
                        icon={<Download size={20} />}
                        className="px-8 py-3"
                    >
                        Baixar Imagem
                    </Button>
                </div>
            </div>
        </div>
    );
};
