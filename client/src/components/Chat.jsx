import React, { useEffect, useState, useRef, useCallback } from "react";
import io from "socket.io-client";
import axios from "axios";
import { useAuth } from "../context/AuthContext";
import Profile from "./Profile";

const Chat = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [chats, setChats] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [showProfile, setShowProfile] = useState(false);
  const [typingUsers, setTypingUsers] = useState([]);
  const [replyTo, setReplyTo] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(null);
  const [messagesPage, setMessagesPage] = useState(1);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [unreadCounts, setUnreadCounts] = useState({});

  const { currentUser } = useAuth();
  const socketRef = useRef();
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const typingTimeoutRef = useRef();
  const lastReadMessageRef = useRef(null);

  // Common emojis for reactions
  const reactionEmojis = ["👍", "❤️", "😂", "😮", "😢", "😡"];

  useEffect(() => {
    if (!currentUser) return;

    axios.defaults.headers.common[
      "Authorization"
    ] = `Bearer ${currentUser.token}`;

    // Connect socket
    socketRef.current = io("http://localhost:2000", {
      auth: { token: currentUser.token },
    });

    // Load initial data
    loadChats();
    loadAllUsers();

    // Socket event listeners
    socketRef.current.on("receiveMessage", (message) => {
      setMessages((prev) => [...prev, message]);
      updateChatLastMessage(message);
    });

    socketRef.current.on("onlineUsers", (users) => {
      setOnlineUsers(users);
    });

    socketRef.current.on("userTyping", (data) => {
      if (data.userId !== currentUser.id) {
        setTypingUsers((prev) => {
          const filtered = prev.filter((user) => user.userId !== data.userId);
          if (data.isTyping) {
            return [...filtered, data];
          }
          return filtered;
        });
      }
    });

    socketRef.current.on("reactionUpdate", (data) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg._id === data.messageId
            ? { ...msg, reactions: data.reactions }
            : msg
        )
      );
    });

    socketRef.current.on("messagesRead", (data) => {
      setMessages((prev) =>
        prev.map((msg) => {
          if (data.messageIds.includes(msg._id)) {
            return {
              ...msg,
              readBy: [
                ...(msg.readBy || []),
                {
                  user: { _id: data.userId },
                  readAt: data.readAt,
                },
              ],
            };
          }
          return msg;
        })
      );
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [currentUser]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Mark messages as read when chat is active
  useEffect(() => {
    if (activeChat && messages.length > 0) {
      const unreadMessages = messages.filter(
        (msg) =>
          msg.sender._id !== currentUser.id &&
          !msg.readBy?.some((read) => read.user._id === currentUser.id)
      );

      if (unreadMessages.length > 0) {
        const messageIds = unreadMessages.map((msg) => msg._id);
        socketRef.current?.emit("markAsRead", {
          chatId: activeChat._id,
          messageIds,
        });
      }
    }
  }, [activeChat, messages, currentUser.id]);

  const updateChatLastMessage = useCallback((message) => {
    setChats((prev) =>
      prev
        .map((chat) =>
          chat._id === message.chat
            ? { ...chat, lastMessage: message, lastActivity: message.timestamp }
            : chat
        )
        .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity))
    );
  }, []);

  const loadChats = async () => {
    try {
      const res = await axios.get("http://localhost:2000/api/chats");
      setChats(res.data);

      // Extract unread counts
      const unreadMap = {};
      res.data.forEach((chat) => {
        unreadMap[chat._id] = chat.unreadCount || 0;
      });
      setUnreadCounts(unreadMap);
    } catch (error) {
      console.error("Error loading chats:", error);
    }
  };

  const loadAllUsers = async () => {
    try {
      const res = await axios.get("http://localhost:2000/api/auth/users");
      setAllUsers(res.data);
    } catch (error) {
      console.error("Error loading users:", error);
    }
  };

  const startIndividualChat = async (otherUser) => {
    try {
      const res = await axios.post(
        "http://localhost:2000/api/chats/individual",
        {
          otherUserId: otherUser._id,
        }
      );

      const chat = res.data;
      setActiveChat(chat);
      socketRef.current.emit("joinChat", chat._id);
      loadChatMessages(chat._id);
      loadChats();
    } catch (error) {
      console.error("Error starting chat:", error);
    }
  };

  const loadChatMessages = async (chatId, page = 1) => {
    try {
      const res = await axios.get(
        `http://localhost:2000/api/chats/${chatId}/messages?page=${page}&limit=50`
      );

      if (page === 1) {
        setMessages(res.data);
      } else {
        setMessages((prev) => [...res.data, ...prev]);
      }

      setHasMoreMessages(res.data.length === 50);
      setMessagesPage(page);
    } catch (error) {
      console.error("Error loading messages:", error);
    }
  };

  const selectChat = (chat) => {
    if (activeChat) {
      socketRef.current.emit("leaveChat", activeChat._id);
    }

    setActiveChat(chat);
    setMessages([]);
    setReplyTo(null);
    socketRef.current.emit("joinChat", chat._id);
    loadChatMessages(chat._id);

    // Clear unread count for this chat
    setUnreadCounts((prev) => ({ ...prev, [chat._id]: 0 }));
  };

  const sendMessage = () => {
    if (!input.trim() || !socketRef.current || !activeChat) return;

    socketRef.current.emit("sendMessage", {
      chatId: activeChat._id,
      content: input.trim(),
      replyTo: replyTo?._id,
      messageType: "text",
    });

    setInput("");
    setReplyTo(null);
    stopTyping();
  };

  const sendReaction = (messageId, emoji) => {
    if (!socketRef.current) return;

    socketRef.current.emit("addReaction", {
      messageId,
      emoji,
    });

    setShowEmojiPicker(null);
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    } else {
      handleTyping();
    }
  };

  const handleTyping = () => {
    if (!activeChat) return;

    socketRef.current.emit("typing", {
      chatId: activeChat._id,
      isTyping: true,
    });

    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(stopTyping, 3000);
  };

  const stopTyping = () => {
    if (!activeChat) return;

    socketRef.current.emit("typing", {
      chatId: activeChat._id,
      isTyping: false,
    });

    clearTimeout(typingTimeoutRef.current);
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "now";
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    if (days < 7) return `${days}d`;
    return date.toLocaleDateString();
  };

  const getInitials = (name) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const getRandomGradient = (name) => {
    const gradients = [
      "from-blue-400 to-purple-500",
      "from-green-400 to-blue-500",
      "from-pink-400 to-red-500",
      "from-yellow-400 to-orange-500",
      "from-indigo-400 to-blue-500",
      "from-purple-400 to-pink-500",
    ];
    const index = name.charCodeAt(0) % gradients.length;
    return gradients[index];
  };

  const getChatName = (chat) => {
    if (chat.isGroupChat) {
      return chat.groupName;
    }
    const otherUser = chat.participants.find(
      (p) => p.user._id !== currentUser.id
    );
    return otherUser?.user.username || "Unknown User";
  };

  const getChatAvatar = (chat) => {
    if (chat.isGroupChat) {
      return getInitials(chat.groupName);
    }
    const otherUser = chat.participants.find(
      (p) => p.user._id !== currentUser.id
    );
    return getInitials(otherUser?.user.username || "U");
  };

  const isUserOnline = (userId) => {
    return onlineUsers.some((user) => user.id === userId);
  };

  const getMessageStatus = (message) => {
    if (message.sender._id !== currentUser.id) return null;

    const deliveredCount = message.deliveredTo?.length || 0;
    const readCount = message.readBy?.length || 0;

    if (readCount > 0) return "read";
    if (deliveredCount > 0) return "delivered";
    return "sent";
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case "sent":
        return "✓";
      case "delivered":
        return "✓✓";
      case "read":
        return "✓✓";
      default:
        return "";
    }
  };

  const MessageReactions = ({ message }) => {
    if (!message.reactions || message.reactions.length === 0) return null;

    const reactionCounts = {};
    message.reactions.forEach((reaction) => {
      reactionCounts[reaction.emoji] =
        (reactionCounts[reaction.emoji] || 0) + 1;
    });

    return (
      <div className="flex items-center space-x-1 mt-1">
        {Object.entries(reactionCounts).map(([emoji, count]) => (
          <div
            key={emoji}
            className="bg-white border border-gray-200 rounded-full px-2 py-1 text-xs flex items-center space-x-1 shadow-sm"
          >
            <span>{emoji}</span>
            <span className="text-gray-600">{count}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex h-screen bg-white">
      {/* Sidebar */}
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
        {/* Sidebar Header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold text-gray-900">Chats</h2>
            <div className="flex space-x-2">
              <button
                onClick={() => setShowProfile(true)}
                className="w-9 h-9 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center transition-colors"
              >
                <span className="text-lg">👤</span>
              </button>
            </div>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <input
              type="text"
              placeholder="Search conversations"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-gray-100 rounded-full py-2 px-4 text-sm focus:outline-none focus:bg-gray-200 transition-colors"
            />
          </div>
        </div>

        {/* All Users Section */}
        <div className="p-4 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-600 mb-3">
            Start New Chat
          </h3>
          <div className="space-y-2 max-h-32 overflow-y-auto">
            {allUsers
              .filter((user) =>
                user.username.toLowerCase().includes(searchQuery.toLowerCase())
              )
              .map((user) => (
                <div
                  key={user._id}
                  onClick={() => startIndividualChat(user)}
                  className="flex items-center p-2 hover:bg-gray-100 rounded-lg cursor-pointer"
                >
                  <div className="relative mr-3">
                    <div
                      className={`w-10 h-10 bg-gradient-to-br ${getRandomGradient(
                        user.username
                      )} rounded-full flex items-center justify-center text-white font-semibold text-sm`}
                    >
                      {getInitials(user.username)}
                    </div>
                    {isUserOnline(user._id) && (
                      <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-gray-900 truncate">
                      {user.username}
                    </h4>
                    <p className="text-sm text-gray-500 truncate">
                      {user.profile?.firstName || user.profile?.lastName
                        ? `${user.profile?.firstName || ""} ${
                            user.profile?.lastName || ""
                          }`.trim()
                        : "Start a conversation"}
                    </p>
                  </div>
                </div>
              ))}
          </div>
        </div>

        {/* Chat List */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-2">
            {chats
              .filter((chat) =>
                getChatName(chat)
                  .toLowerCase()
                  .includes(searchQuery.toLowerCase())
              )
              .map((chat) => (
                <div
                  key={chat._id}
                  onClick={() => selectChat(chat)}
                  className={`flex items-center p-3 hover:bg-gray-100 rounded-lg cursor-pointer relative ${
                    activeChat?._id === chat._id ? "bg-blue-50" : ""
                  }`}
                >
                  <div className="relative mr-3">
                    <div
                      className={`w-12 h-12 bg-gradient-to-br ${getRandomGradient(
                        getChatName(chat)
                      )} rounded-full flex items-center justify-center text-white font-semibold`}
                    >
                      {getChatAvatar(chat)}
                    </div>
                    {!chat.isGroupChat &&
                      (() => {
                        const otherUser = chat.participants.find(
                          (p) => p.user._id !== currentUser.id
                        );
                        return (
                          isUserOnline(otherUser?.user._id) && (
                            <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></div>
                          )
                        );
                      })()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start">
                      <h3 className="font-semibold text-gray-900 truncate">
                        {getChatName(chat)}
                      </h3>
                      <div className="flex flex-col items-end space-y-1">
                        <span className="text-xs text-gray-500">
                          {chat.lastActivity && formatTime(chat.lastActivity)}
                        </span>
                        {unreadCounts[chat._id] > 0 && (
                          <div className="bg-blue-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                            {unreadCounts[chat._id]}
                          </div>
                        )}
                      </div>
                    </div>
                    <p className="text-sm text-gray-500 truncate">
                      {chat.lastMessage?.content || "No messages yet"}
                    </p>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {activeChat ? (
          <>
            {/* Chat Header */}
            <div className="bg-white border-b border-gray-200 p-4 shadow-sm">
              <div className="flex justify-between items-center">
                <div className="flex items-center">
                  <div
                    className={`w-10 h-10 bg-gradient-to-br ${getRandomGradient(
                      getChatName(activeChat)
                    )} rounded-full flex items-center justify-center text-white font-semibold mr-3`}
                  >
                    {getChatAvatar(activeChat)}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">
                      {getChatName(activeChat)}
                    </h3>
                    <p className="text-sm text-gray-500">
                      {!activeChat.isGroupChat &&
                        (() => {
                          const otherUser = activeChat.participants.find(
                            (p) => p.user._id !== currentUser.id
                          );
                          return isUserOnline(otherUser?.user._id)
                            ? "Online"
                            : "Offline";
                        })()}
                      {typingUsers.length > 0 && (
                        <span className="text-blue-500"> • typing...</span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex space-x-2">
                  <button className="w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center transition-colors">
                    <span className="text-lg">📞</span>
                  </button>
                  <button className="w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center transition-colors">
                    <span className="text-lg">📹</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Reply Preview */}
            {replyTo && (
              <div className="bg-blue-50 border-b border-blue-200 px-4 py-2">
                <div className="flex justify-between items-center">
                  <div className="flex-1">
                    <p className="text-xs text-blue-600 font-medium">
                      Replying to {replyTo.sender.username}
                    </p>
                    <p className="text-sm text-gray-700 truncate">
                      {replyTo.content}
                    </p>
                  </div>
                  <button
                    onClick={() => setReplyTo(null)}
                    className="text-blue-600 hover:text-blue-800 ml-2"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}

            {/* Messages Container */}
            <div
              ref={messagesContainerRef}
              className="flex-1 overflow-y-auto p-4 space-y-4"
            >
              {hasMoreMessages && (
                <div className="text-center">
                  <button
                    onClick={() =>
                      loadChatMessages(activeChat._id, messagesPage + 1)
                    }
                    className="text-blue-500 hover:text-blue-700 text-sm"
                  >
                    Load more messages
                  </button>
                </div>
              )}

              {messages.map((msg, idx) => {
                const isOwnMessage = msg.sender._id === currentUser.id;
                const showAvatar =
                  idx === 0 ||
                  messages[idx - 1].sender._id !== msg.sender._id ||
                  new Date(msg.timestamp) -
                    new Date(messages[idx - 1].timestamp) >
                    300000;

                const messageStatus = getMessageStatus(msg);

                return (
                  <div
                    key={msg._id || idx}
                    className={`flex ${
                      isOwnMessage ? "justify-end" : "justify-start"
                    } items-end space-x-2 group`}
                  >
                    {!isOwnMessage && (
                      <div className="w-8 h-8 flex-shrink-0">
                        {showAvatar && (
                          <div
                            className={`w-8 h-8 bg-gradient-to-br ${getRandomGradient(
                              msg.sender.username
                            )} rounded-full flex items-center justify-center text-white font-semibold text-xs`}
                          >
                            {getInitials(msg.sender.username)}
                          </div>
                        )}
                      </div>
                    )}

                    <div
                      className={`max-w-xs lg:max-w-md ${
                        isOwnMessage ? "order-1" : "order-2"
                      }`}
                    >
                      {!isOwnMessage && showAvatar && (
                        <div className="text-xs text-gray-500 mb-1 ml-3">
                          {msg.sender.username}
                        </div>
                      )}

                      {/* Reply Reference */}
                      {msg.replyTo && (
                        <div
                          className={`mb-2 ${isOwnMessage ? "ml-8" : "mr-8"}`}
                        >
                          <div className="bg-gray-100 border-l-4 border-blue-500 pl-3 py-2 rounded">
                            <p className="text-xs text-gray-600">
                              {msg.replyTo.sender.username}
                            </p>
                            <p className="text-sm text-gray-800 truncate">
                              {msg.replyTo.content}
                            </p>
                          </div>
                        </div>
                      )}

                      <div className="group relative">
                        <div
                          className={`px-4 py-2 rounded-2xl relative ${
                            isOwnMessage
                              ? "bg-blue-500 text-white rounded-br-sm"
                              : "bg-gray-100 text-gray-900 rounded-bl-sm"
                          }`}
                        >
                          {msg.content}

                          {/* Message Actions */}
                          <div
                            className={`absolute top-0 ${
                              isOwnMessage
                                ? "left-0 -translate-x-full"
                                : "right-0 translate-x-full"
                            } opacity-0 group-hover:opacity-100 transition-opacity flex space-x-1 bg-white shadow-lg rounded-lg p-1`}
                          >
                            <button
                              onClick={() =>
                                setShowEmojiPicker(
                                  showEmojiPicker === msg._id ? null : msg._id
                                )
                              }
                              className="text-gray-500 hover:text-gray-700 text-xs p-1"
                            >
                              😊
                            </button>
                            <button
                              onClick={() => setReplyTo(msg)}
                              className="text-gray-500 hover:text-gray-700 text-xs p-1"
                            >
                              ↩️
                            </button>
                          </div>
                        </div>

                        {/* Emoji Picker */}
                        {showEmojiPicker === msg._id && (
                          <div className="absolute z-10 bg-white shadow-lg rounded-lg p-2 flex space-x-1 mt-1">
                            {reactionEmojis.map((emoji) => (
                              <button
                                key={emoji}
                                onClick={() => sendReaction(msg._id, emoji)}
                                className="hover:bg-gray-100 p-1 rounded"
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Message Reactions */}
                        <MessageReactions message={msg} />

                        <div
                          className={`text-xs text-gray-500 mt-1 opacity-0 group-hover:opacity-100 transition-opacity flex items-center space-x-2 ${
                            isOwnMessage ? "justify-end" : "justify-start"
                          }`}
                        >
                          <span>{formatTime(msg.timestamp)}</span>
                          {messageStatus && (
                            <span
                              className={`${
                                messageStatus === "read"
                                  ? "text-blue-500"
                                  : "text-gray-400"
                              }`}
                            >
                              {getStatusIcon(messageStatus)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Typing Indicator */}
              {typingUsers.length > 0 && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 rounded-full px-4 py-2">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                      <div
                        className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                        style={{ animationDelay: "0.1s" }}
                      ></div>
                      <div
                        className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                        style={{ animationDelay: "0.2s" }}
                      ></div>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            <div className="border-t border-gray-200 p-4">
              <div className="flex items-end bg-gray-100 rounded-full px-4 py-2 space-x-3">
                <button className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-gray-700 rounded-full transition-colors">
                  <span className="text-lg">📎</span>
                </button>

                <div className="flex-1">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyPress}
                    placeholder="Type a message..."
                    className="w-full bg-transparent resize-none outline-none text-gray-900 placeholder-gray-500"
                    rows="1"
                    style={{
                      minHeight: "20px",
                      maxHeight: "100px",
                    }}
                  />
                </div>

                <button className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-gray-700 rounded-full transition-colors">
                  <span className="text-lg">😊</span>
                </button>

                {input.trim() ? (
                  <button
                    onClick={sendMessage}
                    className="w-8 h-8 bg-blue-500 text-white rounded-full flex items-center justify-center hover:bg-blue-600 transition-colors"
                  >
                    <span className="text-sm">➤</span>
                  </button>
                ) : (
                  <button className="w-8 h-8 flex items-center justify-center text-blue-500 hover:bg-white rounded-full transition-colors">
                    <span className="text-lg">👍</span>
                  </button>
                )}
              </div>
            </div>
          </>
        ) : (
          /* No Chat Selected */
          <div className="flex-1 flex items-center justify-center bg-gray-50">
            <div className="text-center">
              <div className="text-6xl mb-4">💬</div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Welcome to Messenger
              </h3>
              <p className="text-gray-600">Select a chat to start messaging</p>
            </div>
          </div>
        )}
      </div>

      {/* Profile Modal */}
      <Profile isOpen={showProfile} onClose={() => setShowProfile(false)} />
    </div>
  );
};

export default Chat;
