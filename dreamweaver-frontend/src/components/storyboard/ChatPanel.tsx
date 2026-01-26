import React, { useState, useRef, useEffect } from 'react';
import { PaperAirplaneIcon } from '@heroicons/react/24/solid';
import { ChatMessage, StoryNode } from '@/app/storyboard/types';
import ContextWidget from './ContextWidget';

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (message: string) => void;
  isGenerating: boolean;
  selectedNode: StoryNode | null;
  onClearSelection: () => void;
}

const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  onSendMessage,
  isGenerating,
  selectedNode,
  onClearSelection
}) => {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isGenerating) {
      onSendMessage(input);
      setInput('');
    }
  };

  return (
    <div className="flex flex-col h-full bg-white border-r border-gray-200 shadow-sm relative">
      <div className="p-4 border-b border-gray-100 bg-white">
        <h2 className="text-gray-800 font-bold flex items-center gap-2 text-lg">
          StoryNodes
        </h2>
        <p className="text-xs text-gray-500 mt-1">AI Storytelling Assistant</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-32" ref={scrollRef}>
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`max-w-[90%] rounded-2xl px-5 py-3 text-sm leading-relaxed shadow-sm ${msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-none'
                  : 'bg-gray-100 text-gray-800 rounded-bl-none border border-gray-200'
                }`}
            >
              {msg.content}
            </div>
            <span className="text-[10px] text-gray-400 mt-1 px-1">
              {msg.role === 'user' ? 'You' : 'AI Assistant'}
            </span>
          </div>
        ))}
        {isGenerating && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl rounded-bl-none px-4 py-3 border border-gray-200">
              <div className="flex space-x-2">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input Area Wrapper */}
      <div className="absolute bottom-0 left-0 right-0 bg-white/80 backdrop-blur-md border-t border-gray-100">
        {/* Context Widget Floating Above Input */}
        {selectedNode && (
          <ContextWidget selectedNode={selectedNode} onClearSelection={onClearSelection} />
        )}

        <form onSubmit={handleSubmit} className="p-4 pt-2">
          <div className="relative shadow-sm rounded-xl">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={selectedNode ? `Edit "${selectedNode.data.label}"...` : "Type a story prompt or instruction..."}
              disabled={isGenerating}
              className={`w-full bg-gray-50 text-gray-900 placeholder-gray-400 rounded-xl pl-4 pr-12 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-200 disabled:opacity-50 transition-all ${selectedNode ? 'ring-2 ring-blue-100 border-blue-200 bg-blue-50/30' : ''}`}
            />
            <button
              type="submit"
              disabled={!input.trim() || isGenerating}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-blue-600 hover:text-blue-700 disabled:text-gray-400 transition-colors"
            >
              <PaperAirplaneIcon className="w-5 h-5" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ChatPanel;