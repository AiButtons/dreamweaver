import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { StoryData } from '@/app/storyboard/types';
import { PlayIcon, PauseIcon, PhotoIcon } from '@heroicons/react/24/solid';

const CustomNode = ({ data, selected }: NodeProps<StoryData>) => {
  return (
    <div className={`w-[320px] bg-white rounded-2xl shadow-xl transition-all duration-200 overflow-hidden flex flex-col group ${selected ? 'ring-2 ring-blue-500 shadow-blue-100' : 'border border-gray-100'}`}>
      <Handle type="target" position={Position.Left} className="!bg-slate-400 !w-3 !h-3" />

      {/* Media Preview Area */}
      <div className="h-48 bg-slate-100 relative overflow-hidden">
        {data.video ? (
          <video src={data.video} controls className="w-full h-full object-cover" />
        ) : data.image ? (
          <>
            <img src={data.image} alt={data.label} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
            {data.inputImage && (
              <div className="absolute bottom-2 left-2 w-20 h-20 rounded-lg border-2 border-white shadow-lg overflow-hidden z-20 hover:scale-110 transition-transform cursor-pointer" title="Input Image">
                <img src={data.inputImage} alt="Input" className="w-full h-full object-cover" />
              </div>
            )}
          </>
        ) : data.inputImage ? (
          <img src={data.inputImage} alt="Input w-full h-full object-cover" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-300 bg-slate-50">
            <PhotoIcon className="w-12 h-12" />
          </div>
        )}

        {/* Processing State */}
        {data.isProcessing && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-10">
            <div className="flex flex-col items-center text-white">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-white/30 border-t-white mb-2"></div>
              <span className="text-[10px] font-bold uppercase tracking-widest">
                {data.processingTask || 'Processing'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Content Area */}
      <div className="p-4 flex-1 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-slate-800 text-sm">{data.label}</h3>
        </div>

        <p className="text-xs text-slate-500 leading-relaxed line-clamp-4">{data.segment}</p>

        {/* Audio Player Styling (Mock visual if audio exists) */}
        {data.audio && (
          <div className="mt-2 bg-slate-50 rounded-lg p-2 flex items-center gap-2 border border-slate-100">
            <button className="w-6 h-6 bg-white rounded-full flex items-center justify-center shadow-sm text-slate-700 hover:text-blue-500">
              <PlayIcon className="w-3 h-3 ml-0.5" />
            </button>
            <div className="flex-1 h-1 bg-slate-200 rounded-full overflow-hidden">
              <div className="w-1/3 h-full bg-slate-400 rounded-full"></div>
            </div>
            <span className="text-[9px] font-mono text-slate-400">0:00</span>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="!bg-slate-400 !w-3 !h-3" />
    </div>
  );
};

export default memo(CustomNode);