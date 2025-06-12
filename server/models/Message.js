const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  chat: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Chat",
    required: true,
  },
  content: {
    type: String,
    required: function () {
      return this.messageType === "text" || this.messageType === "reply";
    },
  },
  messageType: {
    type: String,
    enum: [
      "text",
      "image",
      "file",
      "audio",
      "video",
      "emoji",
      "reply",
      "system",
    ],
    default: "text",
  },
  attachments: [
    {
      url: String,
      filename: String,
      size: Number,
      mimeType: String,
    },
  ],
  replyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Message",
  },
  reactions: [
    {
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      emoji: {
        type: String,
        required: true,
      },
      createdAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],
  readBy: [
    {
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      readAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],
  deliveredTo: [
    {
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      deliveredAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],
  isEdited: {
    type: Boolean,
    default: false,
  },
  editHistory: [
    {
      content: String,
      editedAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],
  isDeleted: {
    type: Boolean,
    default: false,
  },
  deletedFor: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  ],
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

// Index for faster queries
messageSchema.index({ chat: 1, timestamp: -1 });
messageSchema.index({ sender: 1 });

module.exports = mongoose.model("Message", messageSchema);
