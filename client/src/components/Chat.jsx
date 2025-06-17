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
  const [notifications, setNotifications] = useState([]);
  const [notificationPermission, setNotificationPermission] =
    useState("default");
  const [loading, setLoading] = useState(false);

  const { currentUser } = useAuth();
  const socketRef = useRef();
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const typingTimeoutRef = useRef();
  const audioRef = useRef(new Audio("/notification.mp3"));

  // Common emojis for reactions
  const reactionEmojis = ["👍", "❤️", "😂", "😮", "😢", "😡"];

  // Request notification permission
  const requestNotificationPermission = async () => {
    if ("Notification" in window) {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      return permission;
    }
    return "denied";
  };

  // Show browser notification
  const showBrowserNotification = (title, body) => {
    if (notificationPermission === "granted" && "Notification" in window) {
      new Notification(title, {
        body,
        icon: "/favicon.ico",
        badge: "/favicon.ico",
        tag: "chat-message",
      });
    }
  };

  // Play notification sound
  const playNotificationSound = () => {
    if (audioRef.current) {
      audioRef.current.play().catch(console.error);
    }
  };

  // Show in-app notification
  const showInAppNotification = (notification) => {
    setNotifications((prev) => [...prev, { ...notification, id: Date.now() }]);
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== notification.id));
    }, 5000);
  };

  // Remove notification
  const removeNotification = (id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  useEffect(() => {
    if (!currentUser) return;

    requestNotificationPermission();
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

    socketRef.current.on("newMessageNotification", (data) => {
      const { chatId, senderName, message } = data;

      if (!activeChat || activeChat._id !== chatId) {
        showBrowserNotification(`New message from ${senderName}`, message);
        playNotificationSound();
        showInAppNotification({
          id: Date.now(),
          chatId,
          senderName,
          message,
        });
      }
    });

    socketRef.current.on("updateUnreadCount", (data) => {
      const { chatId, increment, reset } = data;

      setUnreadCounts((prev) => {
        if (reset) {
          return { ...prev, [chatId]: 0 };
        } else if (increment) {
          return { ...prev, [chatId]: (prev[chatId] || 0) + 1 };
        }
        return prev;
      });
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
      setLoading(true);
      const res = await axios.get("http://localhost:2000/api/chats");
      setChats(res.data);

      const unreadMap = {};
      res.data.forEach((chat) => {
        unreadMap[chat._id] = chat.unreadCount || 0;
      });
      setUnreadCounts(unreadMap);
    } catch (error) {
      console.error("Error loading chats:", error);
    } finally {
      setLoading(false);
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
      setLoading(true);
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
    } finally {
      setLoading(false);
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

    setUnreadCounts((prev) => ({ ...prev, [chat._id]: 0 }));
    setNotifications((prev) => prev.filter((n) => n.chatId !== chat._id));
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
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const getInitials = (name) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const getRandomColor = (name) => {
    const colors = [
      "bg-gradient-to-br from-purple-500 to-pink-500",
      "bg-gradient-to-br from-blue-500 to-purple-600",
      "bg-gradient-to-br from-green-500 to-blue-500",
      "bg-gradient-to-br from-yellow-500 to-red-500",
      "bg-gradient-to-br from-pink-500 to-red-500",
      "bg-gradient-to-br from-indigo-500 to-purple-500",
      "bg-gradient-to-br from-teal-500 to-green-500",
      "bg-gradient-to-br from-orange-500 to-pink-500",
    ];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
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

    const readCount = message.readBy?.length || 0;
    const deliveredCount = message.deliveredTo?.length || 0;

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
            className="bg-white border border-gray-200 rounded-full px-2 py-1 text-xs flex items-center space-x-1 shadow-md hover:shadow-lg transition-shadow"
          >
            <span>{emoji}</span>
            <span className="text-gray-600 font-medium">{count}</span>
          </div>
        ))}
      </div>
    );
  };

  // Notification Component
  const NotificationItem = ({ notification, onRemove }) => (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-4 mb-3 max-w-sm backdrop-blur-lg bg-opacity-95">
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <div className="flex items-center space-x-3 mb-2">
            <div
              className={`w-10 h-10 ${getRandomColor(
                notification.senderName
              )} rounded-full flex items-center justify-center text-white font-bold text-sm shadow-lg`}
            >
              {getInitials(notification.senderName)}
            </div>
            <span className="font-semibold text-gray-900 text-sm">
              {notification.senderName}
            </span>
          </div>
          <p className="text-gray-700 text-sm leading-relaxed">
            {notification.message.length > 60
              ? notification.message.substring(0, 60) + "..."
              : notification.message}
          </p>
        </div>
        <button
          onClick={() => onRemove(notification.id)}
          className="text-gray-400 hover:text-gray-600 ml-2 transition-colors"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-gradient-to-br from-indigo-50 via-white to-cyan-50 relative">
      {/* Notification Container */}
      {notifications.length > 0 && (
        <div className="fixed top-4 right-4 z-50 space-y-2">
          {notifications.map((notification) => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              onRemove={removeNotification}
            />
          ))}
        </div>
      )}

      {/* Sidebar */}
      <div className="w-80 bg-white/80 backdrop-blur-xl border-r border-gray-200/50 flex flex-col shadow-xl">
        {/* Sidebar Header */}
        <div className="p-6 border-b border-gray-200/50">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
              Messages
            </h2>
            <div className="flex space-x-2">
              <button
                onClick={() => setShowProfile(true)}
                className="w-10 h-10 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 rounded-xl flex items-center justify-center transition-all duration-200 shadow-lg hover:shadow-xl"
              >
                <svg
                  className="w-5 h-5 text-white"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
              <button
                onClick={requestNotificationPermission}
                className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 shadow-lg hover:shadow-xl ${
                  notificationPermission === "granted"
                    ? "bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white"
                    : "bg-gradient-to-r from-gray-400 to-gray-500 hover:from-gray-500 hover:to-gray-600 text-white"
                }`}
              >
                <svg
                  className="w-5 h-5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
                </svg>
              </button>
            </div>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg
                className="h-5 w-5 text-gray-400"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-gray-100/50 rounded-xl py-3 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:bg-white transition-all duration-200 border border-gray-200/50"
            />
          </div>
        </div>

        {/* All Users Section */}
        <div className="p-4 border-b border-gray-200/50">
          <h3 className="text-sm font-semibold text-gray-600 mb-3">
            Start New Chat
          </h3>
          <div className="space-y-2 max-h-32 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent">
            {allUsers
              .filter((user) =>
                user.username.toLowerCase().includes(searchQuery.toLowerCase())
              )
              .map((user) => (
                <div
                  key={user._id}
                  onClick={() => startIndividualChat(user)}
                  className="flex items-center p-3 hover:bg-purple-50/50 rounded-xl cursor-pointer transition-all duration-200 group"
                >
                  <div className="relative mr-3">
                    <div
                      className={`w-10 h-10 ${getRandomColor(
                        user.username
                      )} rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-lg group-hover:shadow-xl transition-shadow`}
                    >
                      {getInitials(user.username)}
                    </div>
                    {isUserOnline(user._id) && (
                      <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 border-2 border-white rounded-full shadow-lg"></div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-gray-900 truncate">
                      {user.username}
                    </h4>
                    <p className="text-sm text-gray-500 truncate">
                      Start a conversation
                    </p>
                  </div>
                </div>
              ))}
          </div>
        </div>

        {/* Chat List */}
        <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent">
          <div className="p-2">
            {loading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
              </div>
            ) : (
              chats
                .filter((chat) =>
                  getChatName(chat)
                    .toLowerCase()
                    .includes(searchQuery.toLowerCase())
                )
                .map((chat) => (
                  <div
                    key={chat._id}
                    onClick={() => selectChat(chat)}
                    className={`flex items-center p-4 hover:bg-purple-50/50 rounded-xl cursor-pointer transition-all duration-200 group relative ${
                      activeChat?._id === chat._id
                        ? "bg-gradient-to-r from-purple-100 to-pink-100 shadow-lg"
                        : ""
                    }`}
                  >
                    <div className="relative mr-4">
                      <div
                        className={`w-12 h-12 ${getRandomColor(
                          getChatName(chat)
                        )} rounded-xl flex items-center justify-center text-white font-bold shadow-lg group-hover:shadow-xl transition-shadow`}
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
                              <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 border-2 border-white rounded-full shadow-lg"></div>
                            )
                          );
                        })()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start mb-1">
                        <h3 className="font-semibold text-gray-900 truncate">
                          {getChatName(chat)}
                        </h3>
                        <div className="flex flex-col items-end space-y-1">
                          <span className="text-xs text-gray-500">
                            {chat.lastActivity && formatTime(chat.lastActivity)}
                          </span>
                          {unreadCounts[chat._id] > 0 && (
                            <div className="bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center font-bold shadow-lg">
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
                ))
            )}
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {activeChat ? (
          <>
            {/* Chat Header */}
            <div className="bg-white/80 backdrop-blur-xl border-b border-gray-200/50 p-6 shadow-lg">
              <div className="flex justify-between items-center">
                <div className="flex items-center">
                  <div
                    className={`w-12 h-12 ${getRandomColor(
                      getChatName(activeChat)
                    )} rounded-xl flex items-center justify-center text-white font-bold mr-4 shadow-lg`}
                  >
                    {getChatAvatar(activeChat)}
                  </div>
                  <div>
                    <h3 className="font-bold text-xl text-gray-900">
                      {getChatName(activeChat)}
                    </h3>
                    <p className="text-sm text-gray-500">
                      {!activeChat.isGroupChat &&
                        (() => {
                          const otherUser = activeChat.participants.find(
                            (p) => p.user._id !== currentUser.id
                          );
                          return isUserOnline(otherUser?.user._id)
                            ? "🟢 Online"
                            : "⚫ Offline";
                        })()}
                      {typingUsers.length > 0 && (
                        <span className="text-purple-500 font-medium">
                          {" "}
                          • typing...
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Reply Preview */}
            {replyTo && (
              <div className="bg-gradient-to-r from-purple-50 to-pink-50 border-b border-purple-200/50 px-6 py-4">
                <div className="flex justify-between items-center">
                  <div className="flex-1">
                    <p className="text-xs text-purple-600 font-semibold mb-1">
                      Replying to {replyTo.sender.username}
                    </p>
                    <p className="text-sm text-gray-700 truncate bg-white/50 rounded-lg px-3 py-2">
                      {replyTo.content}
                    </p>
                  </div>
                  <button
                    onClick={() => setReplyTo(null)}
                    className="text-purple-600 hover:text-purple-800 ml-4 p-2 hover:bg-white/50 rounded-lg transition-all"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            )}

            {/* Messages Container */}
            <div
              ref={messagesContainerRef}
              className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-thin scrollbar-thumb-purple-300 scrollbar-track-transparent"
            >
              {hasMoreMessages && (
                <div className="text-center">
                  <button
                    onClick={() =>
                      loadChatMessages(activeChat._id, messagesPage + 1)
                    }
                    className="text-purple-500 hover:text-purple-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-purple-50 transition-all"
                  >
                    Load more messages
                  </button>
                </div>
              )}

              {loading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
                </div>
              ) : (
                messages.map((msg, idx) => {
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
                      } items-end space-x-3 group`}
                    >
                      {!isOwnMessage && (
                        <div className="w-8 h-8 flex-shrink-0">
                          {showAvatar && (
                            <div
                              className={`w-8 h-8 ${getRandomColor(
                                msg.sender.username
                              )} rounded-lg flex items-center justify-center text-white font-bold text-xs shadow-lg`}
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
                          <div className="text-xs text-gray-500 mb-2 ml-3 font-medium">
                            {msg.sender.username}
                          </div>
                        )}

                        {/* Reply Reference */}
                        {msg.replyTo && (
                          <div
                            className={`mb-3 ${isOwnMessage ? "ml-8" : "mr-8"}`}
                          >
                            <div className="bg-gray-100/50 border-l-4 border-purple-500 pl-4 py-3 rounded-r-lg backdrop-blur-sm">
                              <p className="text-xs text-purple-600 font-semibold">
                                {msg.replyTo.sender.username}
                              </p>
                              <p className="text-sm text-gray-800 truncate mt-1">
                                {msg.replyTo.content}
                              </p>
                            </div>
                          </div>
                        )}

                        <div className="group relative">
                          <div
                            className={`px-4 py-3 rounded-2xl relative shadow-lg ${
                              isOwnMessage
                                ? "bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-br-md"
                                : "bg-white text-gray-900 rounded-bl-md border border-gray-100"
                            }`}
                          >
                            {msg.content}

                            {/* Message Actions */}
                            <div
                              className={`absolute top-0 ${
                                isOwnMessage
                                  ? "left-0 -translate-x-full"
                                  : "right-0 translate-x-full"
                              } opacity-0 group-hover:opacity-100 transition-opacity flex space-x-1 bg-white shadow-xl rounded-lg p-2 border border-gray-200`}
                            >
                              <button
                                onClick={() =>
                                  setShowEmojiPicker(
                                    showEmojiPicker === msg._id ? null : msg._id
                                  )
                                }
                                className="text-gray-500 hover:text-gray-700 text-xs p-1 hover:bg-gray-100 rounded transition-all"
                              >
                                😊
                              </button>
                              <button
                                onClick={() => setReplyTo(msg)}
                                className="text-gray-500 hover:text-gray-700 text-xs p-1 hover:bg-gray-100 rounded transition-all"
                              >
                                ↩️
                              </button>
                            </div>
                          </div>

                          {/* Emoji Picker */}
                          {showEmojiPicker === msg._id && (
                            <div className="absolute z-10 bg-white shadow-xl rounded-xl p-3 flex space-x-2 mt-2 border border-gray-200">
                              {reactionEmojis.map((emoji) => (
                                <button
                                  key={emoji}
                                  onClick={() => sendReaction(msg._id, emoji)}
                                  className="hover:bg-gray-100 p-2 rounded-lg transition-all hover:scale-110"
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          )}

                          {/* Message Reactions */}
                          <MessageReactions message={msg} />

                          <div
                            className={`text-xs text-gray-500 mt-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center space-x-2 ${
                              isOwnMessage ? "justify-end" : "justify-start"
                            }`}
                          >
                            <span>{formatTime(msg.timestamp)}</span>
                            {messageStatus && (
                              <span
                                className={`${
                                  messageStatus === "read"
                                    ? "text-purple-500"
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
                })
              )}

              {/* Typing Indicator */}
              {typingUsers.length > 0 && (
                <div className="flex justify-start">
                  <div className="bg-white rounded-full px-4 py-3 shadow-lg border border-gray-200">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce"></div>
                      <div
                        className="w-2 h-2 bg-purple-400 rounded-full animate-bounce"
                        style={{ animationDelay: "0.1s" }}
                      ></div>
                      <div
                        className="w-2 h-2 bg-purple-400 rounded-full animate-bounce"
                        style={{ animationDelay: "0.2s" }}
                      ></div>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            <div className="border-t border-gray-200/50 p-6 bg-white/80 backdrop-blur-xl">
              <div className="flex items-end bg-gray-100/50 rounded-2xl px-4 py-3 space-x-3 border border-gray-200/50 focus-within:ring-2 focus-within:ring-purple-500/50 transition-all">
                <div className="flex-1">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyPress}
                    placeholder="Type a message..."
                    className="w-full bg-transparent resize-none outline-none text-gray-900 placeholder-gray-500"
                    rows="1"
                    style={{
                      minHeight: "24px",
                      maxHeight: "120px",
                    }}
                  />
                </div>

                {input.trim() ? (
                  <button
                    onClick={sendMessage}
                    className="w-10 h-10 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl flex items-center justify-center hover:from-purple-600 hover:to-pink-600 transition-all shadow-lg hover:shadow-xl"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                    </svg>
                  </button>
                ) : (
                  <button className="w-10 h-10 flex items-center justify-center text-purple-500 hover:bg-purple-50 rounded-xl transition-all">
                    <span className="text-xl">👍</span>
                  </button>
                )}
              </div>
            </div>
          </>
        ) : (
          /* No Chat Selected */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-24 h-24 bg-gradient-to-br from-purple-400 to-pink-400 rounded-3xl flex items-center justify-center mb-6 mx-auto shadow-2xl">
                <svg
                  className="w-12 h-12 text-white"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <h3 className="text-3xl font-bold text-gray-900 mb-4">
                Welcome to Messenger
              </h3>
              <p className="text-gray-600 text-lg">
                Select a chat to start messaging or create a new conversation
              </p>
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
