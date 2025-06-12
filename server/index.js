const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const dotenv = require("dotenv");
const jwt = require("jsonwebtoken");

// Import models
const Message = require("./models/Message");
const Chat = require("./models/Chat");
const User = require("./models/User");

// Import routes
const authRoutes = require("./routes/auth");
const chatRoutes = require("./routes/chat");

dotenv.config();
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000", "http://localhost:3002"],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  },
});

// Remove deprecated options
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB connected successfully!");
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  });

app.use(
  cors({
    origin: ["http://localhost:3000", "http://localhost:3002"],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/chats", chatRoutes);

// Test route
app.get("/", (req, res) => {
  res.json({ message: "Chat Server is running!" });
});

// Socket.io connection handling
const connectedUsers = new Map();
const typingUsers = new Map();

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error("Authentication error"));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);

    if (!user) {
      return next(new Error("User not found"));
    }

    socket.user = {
      id: user._id.toString(),
      username: user.username,
      profile: user.profile,
    };

    next();
  } catch (err) {
    next(new Error("Authentication error"));
  }
});

io.on("connection", async (socket) => {
  console.log(`User connected: ${socket.user.username} (${socket.id})`);

  // Store connected user
  connectedUsers.set(socket.user.id, {
    id: socket.user.id,
    username: socket.user.username,
    profile: socket.user.profile,
    socketId: socket.id,
    lastSeen: new Date(),
  });

  // Update user online status
  await User.findByIdAndUpdate(socket.user.id, {
    isOnline: true,
  });

  // Join user to their personal room
  socket.join(socket.user.id);

  // Send updated online users to all clients
  io.emit("onlineUsers", Array.from(connectedUsers.values()));

  // Handle joining chat rooms
  socket.on("joinChat", async (chatId) => {
    try {
      // Verify user is participant in this chat
      const chat = await Chat.findOne({
        _id: chatId,
        "participants.user": socket.user.id,
      });

      if (chat) {
        socket.join(chatId);
        console.log(`${socket.user.username} joined chat: ${chatId}`);

        // Mark messages as delivered
        await Message.updateMany(
          {
            chat: chatId,
            sender: { $ne: socket.user.id },
            "deliveredTo.user": { $ne: socket.user.id },
          },
          {
            $push: {
              deliveredTo: {
                user: socket.user.id,
                deliveredAt: new Date(),
              },
            },
          }
        );

        // Notify others that user is online in this chat
        socket.to(chatId).emit("userJoinedChat", {
          userId: socket.user.id,
          username: socket.user.username,
        });
      }
    } catch (error) {
      console.error("Error joining chat:", error);
    }
  });

  // Handle leaving chat rooms
  socket.on("leaveChat", (chatId) => {
    socket.leave(chatId);
    console.log(`${socket.user.username} left chat: ${chatId}`);

    // Stop typing if user was typing
    const typingKey = `${chatId}-${socket.user.id}`;
    if (typingUsers.has(typingKey)) {
      typingUsers.delete(typingKey);
      socket.to(chatId).emit("userStoppedTyping", {
        userId: socket.user.id,
        username: socket.user.username,
      });
    }
  });

  // Handle sending messages
  socket.on("sendMessage", async (messageData) => {
    try {
      const { chatId, content, replyTo, messageType = "text" } = messageData;

      console.log("Sending message:", {
        chatId,
        content,
        userId: socket.user.id,
      });

      // Verify user is participant in this chat
      const chat = await Chat.findOne({
        _id: chatId,
        "participants.user": socket.user.id,
      });

      if (!chat) {
        console.log("Access denied to chat:", chatId);
        socket.emit("error", "Access denied to this chat");
        return;
      }

      // Create new message
      const message = new Message({
        sender: socket.user.id,
        chat: chatId,
        content: content.trim(),
        messageType,
        replyTo: replyTo || undefined,
      });

      await message.save();
      await message.populate([
        { path: "sender", select: "username profile" },
        {
          path: "replyTo",
          select: "content sender",
          populate: { path: "sender", select: "username" },
        },
      ]);

      console.log("Message saved:", message._id);

      // Update chat's last message and activity
      await Chat.findByIdAndUpdate(chatId, {
        lastMessage: message._id,
        lastActivity: new Date(),
      });

      // Send message to all participants in the chat
      io.to(chatId).emit("receiveMessage", message);
    } catch (error) {
      console.error("Error sending message:", error);
      socket.emit("error", "Failed to send message");
    }
  });

  // Handle typing indicators
  socket.on("typing", (data) => {
    const { chatId, isTyping } = data;
    const typingKey = `${chatId}-${socket.user.id}`;

    if (isTyping) {
      typingUsers.set(typingKey, {
        userId: socket.user.id,
        username: socket.user.username,
        chatId,
        timestamp: Date.now(),
      });

      socket.to(chatId).emit("userTyping", {
        userId: socket.user.id,
        username: socket.user.username,
        isTyping: true,
      });
    } else {
      typingUsers.delete(typingKey);
      socket.to(chatId).emit("userTyping", {
        userId: socket.user.id,
        username: socket.user.username,
        isTyping: false,
      });
    }
  });

  // Handle message reactions
  socket.on("addReaction", async (data) => {
    try {
      const { messageId, emoji } = data;

      const message = await Message.findById(messageId);
      if (!message) return;

      // Remove existing reaction from this user
      message.reactions = message.reactions.filter(
        (r) => r.user.toString() !== socket.user.id
      );

      // Add new reaction
      if (emoji) {
        message.reactions.push({
          user: socket.user.id,
          emoji,
        });
      }

      await message.save();
      await message.populate("reactions.user", "username");

      // Broadcast reaction update
      io.to(message.chat.toString()).emit("reactionUpdate", {
        messageId,
        reactions: message.reactions,
      });
    } catch (error) {
      console.error("Error adding reaction:", error);
    }
  });

  // Handle message read receipts
  socket.on("markAsRead", async (data) => {
    try {
      const { chatId, messageIds } = data;

      await Message.updateMany(
        {
          _id: { $in: messageIds },
          chat: chatId,
          "readBy.user": { $ne: socket.user.id },
        },
        {
          $push: {
            readBy: {
              user: socket.user.id,
              readAt: new Date(),
            },
          },
        }
      );

      // Notify other participants
      socket.to(chatId).emit("messagesRead", {
        userId: socket.user.id,
        messageIds,
        readAt: new Date(),
      });
    } catch (error) {
      console.error("Error marking messages as read:", error);
    }
  });

  // Handle disconnect
  socket.on("disconnect", async () => {
    console.log(`User disconnected: ${socket.user.username} (${socket.id})`);

    // Remove from connected users
    connectedUsers.delete(socket.user.id);

    // Clear typing indicators
    for (const [key, value] of typingUsers.entries()) {
      if (value.userId === socket.user.id) {
        typingUsers.delete(key);
        socket.to(value.chatId).emit("userTyping", {
          userId: socket.user.id,
          username: socket.user.username,
          isTyping: false,
        });
      }
    }

    // Update user offline status
    await User.findByIdAndUpdate(socket.user.id, {
      isOnline: false,
      lastSeen: new Date(),
    });

    // Send updated online users to all clients
    io.emit("onlineUsers", Array.from(connectedUsers.values()));
  });
});

// Clean up typing indicators every 10 seconds
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of typingUsers.entries()) {
    if (now - value.timestamp > 10000) {
      // 10 seconds
      typingUsers.delete(key);
      io.to(value.chatId).emit("userTyping", {
        userId: value.userId,
        username: value.username,
        isTyping: false,
      });
    }
  }
}, 10000);

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received. Shutting down gracefully...");
  server.close(() => {
    console.log("Server closed.");
    mongoose.connection.close(false, () => {
      console.log("MongoDB connection closed.");
      process.exit(0);
    });
  });
});

const PORT = process.env.PORT || 2000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 API Base URL: http://localhost:${PORT}`);
  console.log(`📍 Available routes:`);
  console.log(`   GET  http://localhost:${PORT}/api/auth/users`);
  console.log(`   POST http://localhost:${PORT}/api/chats/individual`);
  console.log(`   GET  http://localhost:${PORT}/api/chats`);
});
