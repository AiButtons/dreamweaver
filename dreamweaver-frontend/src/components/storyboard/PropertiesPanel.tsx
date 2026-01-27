import React, { useState } from 'react';
import { StoryNode, StoryEdge, MediaType, VoiceName, AudioConfig, ImageConfig, VideoConfig } from '@/app/storyboard/types';
import {
   PhotoIcon,
   VideoCameraIcon,
   MusicalNoteIcon,
   PencilIcon,
   XMarkIcon,
   SparklesIcon,
   ArrowsRightLeftIcon
} from '@heroicons/react/24/solid';
import { FileUpload } from "@/components/upload/FileUpload";

interface PropertiesPanelProps {
   selectedNode: StoryNode | null;
   nodes?: StoryNode[];
   edges?: StoryEdge[];
   onGenerateMedia: (nodeId: string, type: MediaType, prompt: string, config: any) => void;
   onEditNode: (nodeId: string, instruction: string) => void;
   isProcessing: boolean;
   onClose: () => void;
}

const PropertiesPanel: React.FC<PropertiesPanelProps> = ({ selectedNode, nodes = [], edges = [], onGenerateMedia, onEditNode, isProcessing, onClose }) => {
   const [activeTab, setActiveTab] = useState<'EDIT' | 'MEDIA'>('MEDIA');
   const [mediaType, setMediaType] = useState<MediaType>(MediaType.IMAGE);

   // Media Config States
   const [prompt, setPrompt] = useState('');
   const [negativePrompt, setNegativePrompt] = useState('full body shot, wide shot, distant, rotation of subject, spinning person, morphing, distortion');
   const [style, setStyle] = useState('');
   const [voice, setVoice] = useState<VoiceName>('Kore');
   const [aspectRatio, setAspectRatio] = useState('16:9');
   const [inputImage, setInputImage] = useState<{ file: File; dataUrl: string } | null>(null);
   const [showUpload, setShowUpload] = useState(false);

   // Video Specific Options
   const [audioEnabled, setAudioEnabled] = useState(true);
   const [slowMotion, setSlowMotion] = useState(false);
   const [duration, setDuration] = useState('5');

   if (!selectedNode) return null;
   const { data, id } = selectedNode;

   // Logic to find Next Node (End Image)
   const getNextNode = () => {
      const edge = edges.find(e => e.source === id);
      if (edge) {
         return nodes.find(n => n.id === edge.target);
      }
      return null;
   };
   const nextNode = getNextNode();
   const endImage = nextNode?.data?.image;

   const handleGenerate = () => {
      // Determine config based on type
      let config: any = {};
      if (mediaType === MediaType.AUDIO) config = { voice };
      if (mediaType === MediaType.IMAGE) {
         // Determine effective input image
         const effectiveInputImage = inputImage?.dataUrl || (!showUpload && data.image ? data.image : undefined);
         config = { style, aspectRatio, inputImage: effectiveInputImage };
      }
      if (mediaType === MediaType.VIDEO) {
         // LTX-2 Config
         config = {
            aspectRatio,
            negativePrompt,
            startImage: data.image, // Use current node image as start
            endImage: endImage, // Use next node image as end (if available)
            audioEnabled,
            slowMotion,
            duration: Number(duration)
         };
      }

      // Use specific prompt or fall back to segment text
      const finalPrompt = prompt || data.segment;
      onGenerateMedia(id, mediaType, finalPrompt, config);
   };

   return (
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 flex flex-col overflow-hidden w-[340px] animate-in fade-in zoom-in-95 duration-200">
         {/* Header */}
         <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-white">
            <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
               <SparklesIcon className="w-4 h-4 text-blue-500" />
               {activeTab === 'EDIT' ? 'Edit Node' : 'Generate Media'}
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 rounded-full p-1 hover:bg-gray-50">
               <XMarkIcon className="w-4 h-4" />
            </button>
         </div>

         {/* Mode Switcher */}
         <div className="flex p-1 bg-gray-50 m-4 rounded-lg border border-gray-100">
            <button
               onClick={() => setActiveTab('MEDIA')}
               className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${activeTab === 'MEDIA' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
               Create Media
            </button>
            <button
               onClick={() => setActiveTab('EDIT')}
               className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${activeTab === 'EDIT' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
               Edit Text
            </button>
         </div>

         <div className="px-4 pb-4">
            {activeTab === 'MEDIA' ? (
               <div className="space-y-4">
                  {/* Type Selector */}
                  <div className="grid grid-cols-3 gap-2">
                     <button
                        onClick={() => setMediaType(MediaType.IMAGE)}
                        className={`flex flex-col items-center justify-center p-2 rounded-xl border transition-all ${mediaType === MediaType.IMAGE ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-200 hover:border-gray-300 text-gray-600'}`}
                     >
                        <PhotoIcon className="w-5 h-5 mb-1" />
                        <span className="text-[10px] font-medium">Image</span>
                     </button>
                     <button
                        onClick={() => setMediaType(MediaType.VIDEO)}
                        className={`flex flex-col items-center justify-center p-2 rounded-xl border transition-all ${mediaType === MediaType.VIDEO ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 hover:border-gray-300 text-gray-600'}`}
                     >
                        <VideoCameraIcon className="w-5 h-5 mb-1" />
                        <span className="text-[10px] font-medium">Video</span>
                     </button>
                     <button
                        onClick={() => setMediaType(MediaType.AUDIO)}
                        className={`flex flex-col items-center justify-center p-2 rounded-xl border transition-all ${mediaType === MediaType.AUDIO ? 'border-pink-500 bg-pink-50 text-pink-700' : 'border-gray-200 hover:border-gray-300 text-gray-600'}`}
                     >
                        <MusicalNoteIcon className="w-5 h-5 mb-1" />
                        <span className="text-[10px] font-medium">Audio</span>
                     </button>
                  </div>

                  {/* Config Inputs */}
                  <div className="space-y-3">
                     {mediaType === MediaType.AUDIO ? (
                        <div>
                           <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">Voice</label>
                           <select
                              value={voice}
                              onChange={(e) => setVoice(e.target.value as VoiceName)}
                              className="w-full text-xs p-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                           >
                              <option value="Kore">Kore (Balanced)</option>
                              <option value="Puck">Puck (Energetic)</option>
                              <option value="Charon">Charon (Deep)</option>
                              <option value="Fenrir">Fenrir (Intense)</option>
                              <option value="Zephyr">Zephyr (Calm)</option>
                           </select>
                        </div>
                     ) : (
                        <>
                           {mediaType === MediaType.IMAGE && (
                              <>
                                 <div>
                                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">Aspect Ratio</label>
                                    <select
                                       value={aspectRatio}
                                       onChange={(e) => setAspectRatio(e.target.value)}
                                       className="w-full text-xs p-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                                    >
                                       <option value="16:9">Landscape (16:9)</option>
                                       <option value="1:1">Square (1:1)</option>
                                       <option value="9:16">Portrait (9:16)</option>
                                    </select>
                                 </div>
                                 <div>
                                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">Style</label>
                                    <input
                                       type="text"
                                       value={style}
                                       onChange={(e) => setStyle(e.target.value)}
                                       placeholder="e.g. Cinematic, Realistic"
                                       className="w-full text-xs p-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                                    />
                                 </div>
                                 <div>
                                    {data.image && !inputImage && !showUpload ? (
                                       <div className="relative rounded-lg border border-gray-200 overflow-hidden bg-gray-50 mb-2">
                                          <div className="relative aspect-video bg-black/5 group">
                                             <img
                                                src={data.image}
                                                alt="Generated Input"
                                                className="w-full h-full object-contain"
                                             />
                                             <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                                          </div>
                                          <div className="p-2 border-t border-gray-200 bg-white">
                                             <div className="flex items-center gap-2 mb-2">
                                                <SparklesIcon className="w-3 h-3 text-purple-500" />
                                                <span className="text-[10px] font-medium text-gray-600">Using Generated Image</span>
                                             </div>
                                             <button
                                                onClick={() => setShowUpload(true)}
                                                className="w-full py-1.5 px-3 bg-white border border-gray-200 text-gray-600 hover:text-blue-600 hover:border-blue-200 rounded-md text-[10px] font-medium transition-all shadow-sm flex items-center justify-center gap-1"
                                             >
                                                <PhotoIcon className="w-3 h-3" />
                                                Upload Different Image
                                             </button>
                                          </div>
                                       </div>
                                    ) : (
                                       <>
                                          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">Input Image (Optional)</label>
                                          <FileUpload
                                             onFileUpload={(file, dataUrl) => setInputImage({ file, dataUrl })}
                                             onClear={() => setInputImage(null)}
                                             accept="image/*"
                                             maxSizeMB={5}
                                             className="mb-2"
                                          />
                                          {data.image && (
                                             <div className='flex items-center justify-end mt-1'>
                                                <button
                                                   onClick={() => {
                                                      setInputImage(null);
                                                      setShowUpload(false);
                                                   }}
                                                   className="text-[10px] text-blue-600 hover:text-blue-800 flex items-center gap-1 font-medium transition-colors"
                                                >
                                                   <SparklesIcon className="w-3 h-3" />
                                                   Use Generated Image
                                                </button>
                                             </div>
                                          )}
                                       </>
                                    )}
                                 </div>
                              </>
                           )}

                           <div>
                              <div className="flex justify-between items-center mb-1">
                                 <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Prompt (Optional)</label>
                                 <button
                                    onClick={() => setPrompt(prev => prev ? '' : data.segment)}
                                    className="flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-800"
                                 >
                                    <PencilIcon className="w-3 h-3" />
                                    Use Node Text
                                 </button>
                              </div>
                              <textarea
                                 value={prompt}
                                 onChange={(e) => setPrompt(e.target.value)}
                                 placeholder={data.segment}
                                 className="w-full text-xs p-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none h-16 resize-none mb-2"
                              />

                              {/* Negative Prompt for Video */}
                              {mediaType === MediaType.VIDEO && (
                                 <>
                                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">Negative Prompt</label>
                                    <textarea
                                       value={negativePrompt}
                                       onChange={(e) => setNegativePrompt(e.target.value)}
                                       className="w-full text-xs p-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none h-12 resize-none text-gray-500"
                                    />

                                    <div className="mt-4 space-y-4">
                                       {/* LTX-2 Info Badge */}
                                       <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 rounded-lg border border-purple-100 text-purple-700 text-xs font-medium">
                                          <span className="flex items-center justify-center w-5 h-5 bg-purple-200 rounded text-[10px]">L2</span>
                                          LTX-2 Model
                                       </div>

                                       {/* Start & End Frames */}
                                       <div className="grid grid-cols-2 gap-3">
                                          {/* Start Frame */}
                                          <div className="space-y-1">
                                             <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Start Frame</label>
                                             <div className="aspect-video rounded-lg border border-gray-200 bg-gray-50 overflow-hidden relative">
                                                {data.image ? (
                                                   <img src={data.image} className="w-full h-full object-cover" />
                                                ) : (
                                                   <div className="w-full h-full flex items-center justify-center text-gray-300">
                                                      <PhotoIcon className="w-6 h-6" />
                                                   </div>
                                                )}
                                                <div className="absolute top-1 left-1 bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded">This Node</div>
                                             </div>
                                          </div>
                                          {/* End Frame */}
                                          <div className="space-y-1">
                                             <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">End Frame</label>
                                             <div className="aspect-video rounded-lg border border-gray-200 bg-gray-50 overflow-hidden relative">
                                                {endImage ? (
                                                   <img src={endImage} className="w-full h-full object-cover" />
                                                ) : (
                                                   <div className="w-full h-full flex items-center justify-center text-gray-300">
                                                      <span className="text-[8px] text-center px-2">No Next Node Image</span>
                                                   </div>
                                                )}
                                                <div className="absolute top-1 left-1 bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded">Next Node</div>
                                             </div>
                                          </div>
                                       </div>

                                       {/* Row: Ratio & Duration */}
                                       <div className="grid grid-cols-2 gap-3">
                                          <div>
                                             <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 block">Ratio</label>
                                             <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} className="w-full text-xs p-2 rounded-lg border border-gray-200 bg-white focus:outline-none">
                                                <option value="16:9">16:9</option>
                                                <option value="9:16">9:16</option>
                                             </select>
                                          </div>
                                          <div>
                                             <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 block">Duration</label>
                                             <select value={duration} onChange={(e) => setDuration(e.target.value)} className="w-full text-xs p-2 rounded-lg border border-gray-200 bg-white focus:outline-none">
                                                <option value="5">5 Seconds</option>
                                                <option value="10">10 Seconds</option>
                                             </select>
                                          </div>
                                       </div>

                                       {/* Toggles */}
                                       <div className="flex items-center gap-4 pt-1">
                                          <label className="flex items-center gap-2 cursor-pointer group">
                                             <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${audioEnabled ? 'bg-blue-500 border-blue-500' : 'border-gray-300 bg-white'}`}>
                                                {audioEnabled && <div className="w-2 h-2 bg-white rounded-[1px]" />}
                                             </div>
                                             <input type="checkbox" checked={audioEnabled} onChange={e => setAudioEnabled(e.target.checked)} className="hidden" />
                                             <span className="text-xs font-medium text-gray-600 group-hover:text-gray-800">Audio</span>
                                          </label>

                                          <label className="flex items-center gap-2 cursor-pointer group">
                                             <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${slowMotion ? 'bg-blue-500 border-blue-500' : 'border-gray-300 bg-white'}`}>
                                                {slowMotion && <div className="w-2 h-2 bg-white rounded-[1px]" />}
                                             </div>
                                             <input type="checkbox" checked={slowMotion} onChange={e => setSlowMotion(e.target.checked)} className="hidden" />
                                             <span className="text-xs font-medium text-gray-600 group-hover:text-gray-800">Slow Motion</span>
                                          </label>
                                       </div>
                                    </div>
                                 </>
                              )}
                           </div>
                        </>
                     )}
                  </div>

                  <button
                     onClick={handleGenerate}
                     disabled={isProcessing}
                     className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors shadow-sm disabled:opacity-50"
                  >
                     {isProcessing ? 'Generating...' : 'Generate'}
                  </button>
               </div>
            ) : (
               <div className="space-y-3">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">Narrative Text</label>
                  <textarea
                     defaultValue={data.segment}
                     onChange={(e) => setPrompt(e.target.value)}
                     className="w-full text-xs p-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none h-32 resize-none"
                  />
                  <button
                     onClick={() => {
                        if (prompt) onEditNode(id, prompt);
                     }}
                     disabled={isProcessing}
                     className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors shadow-sm disabled:opacity-50"
                  >
                     Update Text
                  </button>
               </div>
            )}
         </div>
      </div>
   );
};

export default PropertiesPanel;