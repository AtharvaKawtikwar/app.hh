"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X, Send } from "lucide-react"; // Ensure lucide-react is installed

interface ChatProps {
  socket: any;
  driveId: string;
  userId: string;
  role: "driver" | "rider";
  onClose: () => void;
}

interface Message {
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
}

export default function ChatWindow({ socket, driveId, userId, role, onClose }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!socket) return;

    // 1. Join the Room (Triggers backend to send history)
    socket.emit("chat:join", driveId);

    // 2. Handle Real-time Messages
    const handleReceive = (msg: Message) => {
      setMessages((prev) => [...prev, msg]);
      setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    };

    // 3. Handle History Load (NEW)
    const handleHistory = (history: Message[]) => {
        setMessages(history);
        setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    };

    socket.on("chat:receive", handleReceive);
    socket.on("chat:history", handleHistory); // <--- Listen for history

    return () => {
      socket.off("chat:receive", handleReceive);
      socket.off("chat:history", handleHistory);
    };
  }, [socket, driveId]);

  const handleSend = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim()) return;

    const payload = {
      driveId,
      senderId: userId,
      senderName: role === "driver" ? "Driver" : "Rider", // Simple name logic
      text: inputText.trim()
    };

    socket.emit("chat:send", payload);
    setInputText("");
  };

  return (
    <Card className="w-80 h-96 shadow-2xl flex flex-col border-2 border-blue-500 animate-in slide-in-from-bottom-10">
      <CardHeader className="bg-blue-600 text-white py-3 px-4 flex flex-row justify-between items-center">
        <CardTitle className="text-sm font-medium">Ride Chat</CardTitle>
        <Button variant="ghost" size="icon" className="h-6 w-6 text-white hover:bg-blue-700" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      
      <CardContent className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
        {messages.length === 0 && (
            <p className="text-center text-xs text-gray-400 mt-10">No messages yet. Say hi!</p>
        )}
        {messages.map((msg, i) => {
          const isMe = msg.senderId === userId;
          return (
            <div key={i} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-lg p-2 text-sm ${isMe ? "bg-blue-600 text-white" : "bg-white border text-gray-800"}`}>
                {!isMe && <p className="text-[10px] font-bold opacity-70 mb-0.5">{msg.senderName}</p>}
                <p>{msg.text}</p>
                <p className={`text-[9px] text-right mt-1 ${isMe ? "text-blue-200" : "text-gray-400"}`}>
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={scrollRef} />
      </CardContent>

      <CardFooter className="p-2 bg-white border-t">
        <form onSubmit={handleSend} className="flex w-full gap-2">
          <Input 
            placeholder="Type a message..." 
            value={inputText} 
            onChange={(e) => setInputText(e.target.value)}
            className="flex-1 h-9 text-sm"
          />
          <Button type="submit" size="icon" className="h-9 w-9 bg-blue-600 hover:bg-blue-700">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </CardFooter>
    </Card>
  );
}