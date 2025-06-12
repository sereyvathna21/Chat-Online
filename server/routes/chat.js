const express = require("express");
const Chat = require("../models/Chat");
const Message = require("../models/Message");
const User = require("../models/User");
const jwt = require("jsonwebtoken");
const router = express.Router();

// Middleware to verify token
const verifyToken = (req, res, next) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: "Invalid token" });
  }
};

// Get all chats for a user with unread count
router.get("/", verifyToken, async (req, res) => {
  try {
    const chats = await Chat.find({
      "participants.user": req.user.userId,
      isArchived: false,
    })
      .populate({
        path: "participants.user",
        select: "username profile isOnline lastSeen",
      })
      .populate({
        path: "lastMessage",
        populate: {
          path: "sender",
          select: "username",
        },
      })
      .sort({ lastActivity: -1 });

    // Add unread count for each chat
    const chatsWithUnread = await Promise.all(
      chats.map(async (chat) => {
        const unreadCount = await Message.countDocuments({
          chat: chat._id,
          sender: { $ne: req.user.userId },
          "readBy.user": { $ne: req.user.userId },
        });

        return {
          ...chat.toObject(),
          unreadCount,
        };
      })
    );

    res.json(chatsWithUnread);
  } catch (error) {
    console.error("Error fetching chats:", error);
    res.status(500).json({ error: error.message });
  }
});

// Create or get individual chat
router.post("/individual", verifyToken, async (req, res) => {
  try {
    const { otherUserId } = req.body;

    // Check if chat already exists
    let chat = await Chat.findOne({
      "participants.user": { $all: [req.user.userId, otherUserId] },
      isGroupChat: false,
    }).populate("participants.user", "username profile isOnline lastSeen");

    if (!chat) {
      // Create new chat
      chat = new Chat({
        participants: [{ user: req.user.userId }, { user: otherUserId }],
        isGroupChat: false,
        createdBy: req.user.userId,
      });
      await chat.save();
      await chat.populate(
        "participants.user",
        "username profile isOnline lastSeen"
      );
    }

    res.json(chat);
  } catch (error) {
    console.error("Error creating/finding chat:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get messages for a specific chat with pagination
router.get("/:chatId/messages", verifyToken, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    // Verify user is participant in this chat
    const chat = await Chat.findOne({
      _id: chatId,
      "participants.user": req.user.userId,
    });

    if (!chat) {
      return res.status(403).json({ error: "Access denied" });
    }

    const messages = await Message.find({
      chat: chatId,
      isDeleted: false,
      deletedFor: { $ne: req.user.userId },
    })
      .populate("sender", "username profile")
      .populate("replyTo", "content sender")
      .populate("reactions.user", "username")
      .sort({ timestamp: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    // Mark messages as read
    await Message.updateMany(
      {
        chat: chatId,
        sender: { $ne: req.user.userId },
        "readBy.user": { $ne: req.user.userId },
      },
      {
        $push: {
          readBy: {
            user: req.user.userId,
            readAt: new Date(),
          },
        },
      }
    );

    res.json(messages.reverse());
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ error: error.message });
  }
});

// Search messages in a chat
router.get("/:chatId/search", verifyToken, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({ error: "Search query is required" });
    }

    const messages = await Message.find({
      chat: chatId,
      content: { $regex: query, $options: "i" },
      isDeleted: false,
      deletedFor: { $ne: req.user.userId },
    })
      .populate("sender", "username profile")
      .sort({ timestamp: -1 })
      .limit(20);

    res.json(messages);
  } catch (error) {
    console.error("Error searching messages:", error);
    res.status(500).json({ error: error.message });
  }
});

// Archive/Unarchive chat
router.patch("/:chatId/archive", verifyToken, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { archive } = req.body;

    const chat = await Chat.findOneAndUpdate(
      {
        _id: chatId,
        "participants.user": req.user.userId,
      },
      { isArchived: archive },
      { new: true }
    );

    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }

    res.json({ message: archive ? "Chat archived" : "Chat unarchived" });
  } catch (error) {
    console.error("Error archiving chat:", error);
    res.status(500).json({ error: error.message });
  }
});

// Mute/Unmute chat
router.patch("/:chatId/mute", verifyToken, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { mute, duration } = req.body; // duration in hours, null for indefinite

    const chat = await Chat.findOne({
      _id: chatId,
      "participants.user": req.user.userId,
    });

    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }

    if (mute) {
      const mutedUntil = duration
        ? new Date(Date.now() + duration * 60 * 60 * 1000)
        : null;

      // Remove existing mute entry for this user
      chat.mutedBy = chat.mutedBy.filter(
        (m) => m.user.toString() !== req.user.userId
      );

      // Add new mute entry
      chat.mutedBy.push({
        user: req.user.userId,
        mutedUntil,
      });
    } else {
      // Remove mute entry for this user
      chat.mutedBy = chat.mutedBy.filter(
        (m) => m.user.toString() !== req.user.userId
      );
    }

    await chat.save();
    res.json({ message: mute ? "Chat muted" : "Chat unmuted" });
  } catch (error) {
    console.error("Error muting chat:", error);
    res.status(500).json({ error: error.message });
  }
});

// Add reaction to message
router.post("/messages/:messageId/react", verifyToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { emoji } = req.body;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    // Remove existing reaction from this user
    message.reactions = message.reactions.filter(
      (r) => r.user.toString() !== req.user.userId
    );

    // Add new reaction if emoji is provided
    if (emoji) {
      message.reactions.push({
        user: req.user.userId,
        emoji,
      });
    }

    await message.save();
    await message.populate("reactions.user", "username");

    res.json(message.reactions);
  } catch (error) {
    console.error("Error adding reaction:", error);
    res.status(500).json({ error: error.message });
  }
});

// Delete message
router.delete("/messages/:messageId", verifyToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { deleteForEveryone } = req.body;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    // Check if user can delete the message
    if (message.sender.toString() !== req.user.userId) {
      return res
        .status(403)
        .json({ error: "You can only delete your own messages" });
    }

    if (deleteForEveryone) {
      // Delete for everyone (only within 10 minutes)
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      if (message.timestamp < tenMinutesAgo) {
        return res
          .status(400)
          .json({ error: "Can only delete for everyone within 10 minutes" });
      }

      message.isDeleted = true;
      message.content = "This message was deleted";
    } else {
      // Delete for self only
      if (!message.deletedFor.includes(req.user.userId)) {
        message.deletedFor.push(req.user.userId);
      }
    }

    await message.save();
    res.json({ message: "Message deleted" });
  } catch (error) {
    console.error("Error deleting message:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
