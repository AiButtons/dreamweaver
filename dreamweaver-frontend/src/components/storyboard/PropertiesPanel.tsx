import React, { useState } from 'react';
import { StoryNode, MediaType, VoiceName, AudioConfig, ImageConfig, VideoConfig } from '@/app/storyboard/types';
import {
   PhotoIcon,
   VideoCameraIcon,
   MusicalNoteIcon,
   PencilIcon,
   XMarkIcon,
   SparklesIcon
} from '@heroicons/react/24/solid';
import { FileUpload } from "@/components/upload/FileUpload";


interface PropertiesPanelProps {
   selectedNode: StoryNode | null;
   onGenerateMedia: (nodeId: string, type: MediaType, prompt: string, config: any) => void;
   onEditNode: (nodeId: string, instruction: string) => void;
   isProcessing: boolean;
   onClose: () => void;
}

const PropertiesPanel: React.FC<PropertiesPanelProps> = ({ selectedNode, onGenerateMedia, onEditNode, isProcessing, onClose }) => {
   const [activeTab, setActiveTab] = useState<'EDIT' | 'MEDIA'>('MEDIA');
   const [mediaType, setMediaType] = useState<MediaType>(MediaType.IMAGE);

   // Media Config States
   const [prompt, setPrompt] = useState('');
   const [style, setStyle] = useState('');
   const [voice, setVoice] = useState<VoiceName>('Kore');
   const [aspectRatio, setAspectRatio] = useState('16:9');
   const [inputImage, setInputImage] = useState<{ file: File; dataUrl: string } | null>(null);

   if (!selectedNode) return null;
   const { data, id } = selectedNode;

   const handleGenerate = () => {
      // Determine config based on type
      let config: any = {};
      if (mediaType === MediaType.AUDIO) config = { voice };
      if (mediaType === MediaType.IMAGE) config = { style, aspectRatio, inputImage: inputImage?.dataUrl };
      if (mediaType === MediaType.VIDEO) config = { style, aspectRatio };

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
                              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">Input Image (Optional)</label>
                              <FileUpload
                                 onFileUpload={(file, dataUrl) => setInputImage({ file, dataUrl })}
                                 onClear={() => setInputImage(null)}
                                 accept="image/*"
                                 maxSizeMB={5}
                                 className="mb-2"
                              />
                           </div>
                        </>
                     )}

                     <div>
                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">Prompt (Optional)</label>
                        <textarea
                           value={prompt}
                           onChange={(e) => setPrompt(e.target.value)}
                           placeholder={data.segment}
                           className="w-full text-xs p-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none h-16 resize-none"
                        />
                     </div>
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