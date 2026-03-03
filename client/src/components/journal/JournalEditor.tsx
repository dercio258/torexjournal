import React from 'react';
import { Editor } from '@tinymce/tinymce-react';

interface JournalEditorProps {
    value: string;
    onEditorChange: (content: string) => void;
    placeholder?: string;
    height?: number;
}

export const JournalEditor: React.FC<JournalEditorProps> = ({ value, onEditorChange, placeholder, height = 300 }) => {
    return (
        <div className="rounded-lg overflow-hidden border border-slate-700">
            <Editor
                apiKey={import.meta.env.VITE_TINY_API_KEY}
                value={value}
                onEditorChange={onEditorChange}
                init={{
                    height: height,
                    menubar: false,
                    plugins: 'anchor autolink charmap codesample emoticons image link lists media searchreplace table visualblocks wordcount',
                    toolbar: 'undo redo | blocks fontfamily fontsize | bold italic underline strikethrough | link image media table | align lineheight | numlist bullist indent outdent | emoticons charmap | removeformat',
                    content_style: 'body { font-family:Inter,sans-serif; font-size:14px; background-color: #1e293b; color: #cbd5e1; }',
                    skin: "oxide-dark",
                    content_css: "dark",
                    placeholder: placeholder
                }}
            />
        </div>
    );
};
