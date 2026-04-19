import React, { memo, useState } from 'react';
import { Handle, Position, NodeProps, useReactFlow } from 'reactflow';
import { StoryNodeData } from '@/app/storyboard/types';
import { PlayIcon, PhotoIcon, ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/solid';

const CustomNode = ({ id, data, selected }: NodeProps<StoryNodeData>) => {
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

  const showVideo = activeMedia === 'video' && data.video;
  const continuityStatus = data.continuity.consistencyStatus;
  const continuityTone = continuityStatus === 'ok'
    ? 'border-emerald-400/35 bg-emerald-400/12 text-emerald-200'
    : continuityStatus === 'warning'
      ? 'border-amber-300/35 bg-amber-300/12 text-amber-100'
      : 'border-rose-300/35 bg-rose-300/12 text-rose-100';
  const typeLabel = data.nodeType.replace('_', ' ');

  return (
    <div
      className={`w-[320px] overflow-hidden rounded-2xl border transition-all duration-200 group backdrop-blur-sm ${
        selected
          ? 'border-lime-300/70 ring-2 ring-lime-300/30 shadow-[0_20px_65px_rgba(132,204,22,0.24)] -translate-y-0.5'
          : 'border-white/15 shadow-[0_14px_45px_rgba(0,0,0,0.45)] hover:border-white/25 hover:-translate-y-0.5'
      } bg-[linear-gradient(180deg,rgba(27,35,49,0.98)_0%,rgba(14,20,32,0.96)_100%)]`}
    >
      <Handle type="target" position={Position.Left} className="!bg-slate-300 !w-3 !h-3 !border !border-slate-900" />

      {/* Media Preview Area */}
      <div className="h-44 bg-slate-900/70 border-b border-white/10 relative overflow-hidden group/media">
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
                  className={`p-1 rounded-full bg-black/55 text-white hover:bg-black/75 transition-colors ${!hasPrev ? 'invisible' : ''}`}
                >
                  <ChevronLeftIcon className="w-5 h-5" />
                </button>
                <button
                  onClick={(e) => hasNext && handleNav(e, 'next')}
                  className={`p-1 rounded-full bg-black/55 text-white hover:bg-black/75 transition-colors ${!hasNext ? 'invisible' : ''}`}
                >
                  <ChevronRightIcon className="w-5 h-5" />
                </button>
              </div>
            )}

            {/* Input Overlay */}
            {data.inputImage && (
              <div
                className="absolute bottom-2 left-2 w-16 h-16 rounded-lg border border-white/30 shadow-lg overflow-hidden z-20 hover:scale-105 transition-transform cursor-pointer"
                title="Input Image"
              >
                <img src={data.inputImage} alt="Input" className="w-full h-full object-cover" />
              </div>
            )}
          </>
        ) : data.inputImage ? (
          <img src={data.inputImage} alt="Input w-full h-full object-cover" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-500 bg-[radial-gradient(circle_at_40%_30%,rgba(148,163,184,0.18),rgba(15,23,42,0.72))]">
            <PhotoIcon className="w-10 h-10" />
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
          <div className="absolute top-2 right-2 flex bg-black/55 rounded-lg p-0.5 z-40 backdrop-blur-sm border border-white/15">
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

      {/* Shot metadata strip */}
      {data.shotMeta && (
        data.shotMeta.size
          || (data.shotMeta.angle && data.shotMeta.angle !== "eye_level")
          || (data.shotMeta.move && data.shotMeta.move !== "static")
          || data.shotMeta.lensMm
          || (data.shotMeta.aspect && data.shotMeta.aspect !== "16:9")
      ) ? (
        <div className="flex flex-wrap items-center gap-1 px-3 py-1.5 border-b border-white/5 bg-black/20">
          {data.shotMeta.size ? (
            <span className="rounded border border-sky-400/25 bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-sky-200">
              {data.shotMeta.size}
            </span>
          ) : null}
          {data.shotMeta.angle && data.shotMeta.angle !== "eye_level" ? (
            <span className="rounded border border-violet-400/25 bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-violet-200">
              {data.shotMeta.angle.replace("_", " ")}
            </span>
          ) : null}
          {data.shotMeta.move && data.shotMeta.move !== "static" ? (
            <span className="rounded border border-amber-400/25 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-amber-200">
              {data.shotMeta.move.replace("_", " ")}
            </span>
          ) : null}
          {data.shotMeta.lensMm ? (
            <span className="rounded border border-slate-400/25 bg-slate-500/15 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-slate-200">
              {data.shotMeta.lensMm}mm
            </span>
          ) : null}
          {data.shotMeta.aspect && data.shotMeta.aspect !== "16:9" ? (
            <span className="rounded border border-emerald-400/25 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-emerald-200">
              {data.shotMeta.aspect}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Content Area */}
      <div className="p-4 flex-1 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-slate-100 text-sm leading-snug line-clamp-2">{data.label}</h3>
          <span className="rounded-full border border-white/20 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-200 shrink-0">
            {typeLabel}
          </span>
        </div>

        <p className="text-xs text-slate-300/90 leading-relaxed line-clamp-4">{data.segment}</p>

        <div className="mt-1 flex items-center justify-between gap-2">
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${continuityTone}`}>
            {continuityStatus}
          </span>
          {(data.media.images.length > 0 || data.media.videos.length > 0) ? (
            <span className="text-[10px] text-slate-400">
              {data.media.images.length} img · {data.media.videos.length} vid
            </span>
          ) : null}
        </div>

        {/* Audio Player Styling (Mock visual if audio exists) */}
        {data.audio && (
          <div className="mt-1 bg-white/5 rounded-lg p-2 flex items-center gap-2 border border-white/10">
            <button className="w-6 h-6 bg-white/10 rounded-full flex items-center justify-center text-slate-200 hover:bg-white/20">
              <PlayIcon className="w-3 h-3 ml-0.5" />
            </button>
            <div className="flex-1 h-1 bg-white/15 rounded-full overflow-hidden">
              <div className="w-1/3 h-full bg-lime-300/75 rounded-full"></div>
            </div>
            <span className="text-[9px] font-mono text-slate-400">0:00</span>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="!bg-slate-300 !w-3 !h-3 !border !border-slate-900" />
    </div>
  );
};

export default memo(CustomNode);
