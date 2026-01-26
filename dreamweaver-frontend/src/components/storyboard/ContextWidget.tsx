import React from 'react';
import { StoryNode } from '@/app/storyboard/types';
import { XMarkIcon, PencilSquareIcon, PhotoIcon } from '@heroicons/react/24/outline';

interface ContextWidgetProps {
    selectedNode: StoryNode;
    onClearSelection: () => void;
}

const ContextWidget: React.FC<ContextWidgetProps> = ({ selectedNode, onClearSelection }) => {
    const { data } = selectedNode;

    return (
        <div className="mx-4 mb-2 p-3 bg-blue-50 border border-blue-100 rounded-xl relative shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-200">
            <button
                onClick={onClearSelection}
                className="absolute top-2 right-2 text-blue-400 hover:text-blue-600 rounded-full p-1 hover:bg-blue-100 transition-colors"
                title="Deselect Node"
            >
                <XMarkIcon className="w-4 h-4" />
            </button>

            <div className="flex gap-3 items-start pr-6">
                {/* Tiny Preview */}
                <div className="w-10 h-10 rounded-lg bg-blue-200 flex-shrink-0 overflow-hidden border border-blue-200">
                    {data.image ? (
                        <img src={data.image} alt="Node Thumb" className="w-full h-full object-cover" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-blue-400">
                            <PhotoIcon className="w-5 h-5" />
                        </div>
                    )}
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 text-blue-800 mb-0.5">
                        <PencilSquareIcon className="w-3.5 h-3.5" />
                        <span className="text-xs font-bold uppercase tracking-wide">Editing Node</span>
                    </div>
                    <h3 className="text-sm font-semibold text-gray-900 truncate">
                        {data.label || 'Untitled Node'}
                    </h3>
                    <p className="text-[10px] text-gray-500 line-clamp-1 mt-0.5">
                        {data.segment || 'No content...'}
                    </p>
                </div>
            </div>
        </div>
    );
};

export default ContextWidget;
