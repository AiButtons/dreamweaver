import React, { memo, useState, useEffect } from 'react';
import { Handle, Position, NodeProps, useReactFlow } from 'reactflow';
import { StoryData } from '@/app/storyboard/types';
import { PlayIcon, PauseIcon, PhotoIcon, ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/solid';

const CustomNode = ({ id, data, selected }: NodeProps<StoryData>) => {
  const { setNodes } = useReactFlow();

  const history = data.imageHistory || [];
  const currentIndex = data.image ? history.indexOf(data.image) : -1;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex !== -1 && currentIndex < history.length - 1;

  const handleNav = (e: React.MouseEvent, direction: 'prev' | 'next') => {
    e.stopPropagation();
    const newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;
    const newImage = history[newIndex];
    setNodes((nds) => nds.map((n) => {
      if (n.id === id) {
        return { ...n, data: { ...n.data, image: newImage } };
      }
      return n;
    }));
  };

  const [activeMedia, setActiveMedia] = useState<'image' | 'video'>('image');

  // Auto-switch to video when it becomes available
  useEffect(() => {
    if (data.video) setActiveMedia('video');
  }, [data.video]);

  // If user manually switches to image, respect that loop unless new video comes
  // (The above effect handles "new video" roughly, but simplistic is fine for now)

  const showVideo = activeMedia === 'video' && data.video;
  const showImage = !showVideo; // Fallback to image view (which might be empty placeholder)

  return (
    <div className={`w-[320px] bg-white rounded-2xl shadow-xl transition-all duration-200 overflow-hidden flex flex-col group ${selected ? 'ring-2 ring-blue-500 shadow-blue-100' : 'border border-gray-100'}`}>
      <Handle type="target" position={Position.Left} className="!bg-slate-400 !w-3 !h-3" />

      {/* Media Preview Area */}
      <div className="h-48 bg-slate-100 relative overflow-hidden group/media">
        {showVideo ? (
          <video src={data.video} controls className="w-full h-full object-cover" />
        ) : data.image ? (
          <>
            <img src={data.image} alt={data.label} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />

            {/* History Navigation */}
            {(hasPrev || hasNext) && (
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-between px-2 opacity-0 group-hover/media:opacity-100 transition-opacity z-30">
                <button
                  onClick={(e) => hasPrev && handleNav(e, 'prev')}
                  className={`p-1 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors ${!hasPrev ? 'invisible' : ''}`}
                >
                  <ChevronLeftIcon className="w-5 h-5" />
                </button>
                <button
                  onClick={(e) => hasNext && handleNav(e, 'next')}
                  className={`p-1 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors ${!hasNext ? 'invisible' : ''}`}
                >
                  <ChevronRightIcon className="w-5 h-5" />
                </button>
              </div>
            )}

            {/* Input Overlay */}
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
        {/* Toggle Controls (if both exist) */}
        {data.image && data.video && (
          <div className="absolute top-2 right-2 flex bg-black/50 rounded-lg p-0.5 z-40 backdrop-blur-sm">
            <button
              onClick={(e) => { e.stopPropagation(); setActiveMedia('image'); }}
              className={`p-1.5 rounded-md transition-all ${activeMedia === 'image' ? 'bg-white text-blue-600 shadow-sm' : 'text-white hover:bg-white/10'}`}
            >
              <PhotoIcon className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setActiveMedia('video'); }}
              className={`p-1.5 rounded-md transition-all ${activeMedia === 'video' ? 'bg-white text-green-600 shadow-sm' : 'text-white hover:bg-white/10'}`}
            >
              <PlayIcon className="w-3 h-3" />
            </button>
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