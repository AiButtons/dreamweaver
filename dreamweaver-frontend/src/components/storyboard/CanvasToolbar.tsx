import React from 'react';
import { 
  PlusIcon, 
  TrashIcon, 
  ArrowsPointingOutIcon, 
  MagnifyingGlassPlusIcon, 
  MagnifyingGlassMinusIcon,
  Square2StackIcon
} from '@heroicons/react/24/outline';

interface CanvasToolbarProps {
  onAddNode: () => void;
  onDeleteNode: () => void;
  onFitView: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  hasSelection: boolean;
}

const CanvasToolbar: React.FC<CanvasToolbarProps> = ({ 
  onAddNode, 
  onDeleteNode, 
  onFitView, 
  onZoomIn, 
  onZoomOut,
  hasSelection
}) => {
  return (
    <div className="absolute right-6 top-6 flex flex-col gap-2 bg-white rounded-lg shadow-xl p-1.5 border border-gray-100 z-10">
      <div className="flex flex-col gap-1 border-b border-gray-100 pb-1.5 mb-0.5">
        <button 
            onClick={onAddNode} 
            className="p-2 hover:bg-gray-50 rounded-md text-gray-600 hover:text-blue-600 transition-colors tooltip"
            title={hasSelection ? "Add Child Node" : "Add New Node"}
        >
            <PlusIcon className="w-5 h-5" />
        </button>
        <button 
            onClick={onDeleteNode} 
            disabled={!hasSelection}
            className="p-2 hover:bg-red-50 rounded-md text-gray-600 hover:text-red-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Delete Selected"
        >
            <TrashIcon className="w-5 h-5" />
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <button onClick={onZoomIn} className="p-2 hover:bg-gray-50 rounded-md text-gray-600 transition-colors" title="Zoom In">
            <MagnifyingGlassPlusIcon className="w-5 h-5" />
        </button>
        <button onClick={onZoomOut} className="p-2 hover:bg-gray-50 rounded-md text-gray-600 transition-colors" title="Zoom Out">
            <MagnifyingGlassMinusIcon className="w-5 h-5" />
        </button>
        <button onClick={onFitView} className="p-2 hover:bg-gray-50 rounded-md text-gray-600 transition-colors" title="Fit View">
            <ArrowsPointingOutIcon className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};

export default CanvasToolbar;