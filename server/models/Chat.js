const mongoose = require("mongoose");

const chatSchema = new mongoose.Schema({
  participants: [
    {
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      joinedAt: {
        type: Date,
        default: Date.now,
      },
      role: {
        type: String,
        enum: ["admin", "member"],
        default: "member",
      },
    },
  ],
  isGroupChat: {
    type: Boolean,
    default: false,
  },
  groupName: {
    type: String,
  },
  groupAvatar: {
    type: String,
  },
  groupDescription: {
    type: String,
  },
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Message",
  },
  lastActivity: {
    type: Date,
    default: Date.now,
  },
  isArchived: {
    type: Boolean,
    default: false,
  },
  mutedBy: [
    {
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      mutedUntil: {
        type: Date,
        default: null, // null means muted indefinitely
      },
    },
  ],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Index for faster queries
chatSchema.index({ "participants.user": 1 });
chatSchema.index({ lastActivity: -1 });
chatSchema.index({ isArchived: 1 });

module.exports = mongoose.model("Chat", chatSchema);
