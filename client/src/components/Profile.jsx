import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";

const Profile = ({ isOpen, onClose }) => {
  const { currentUser, updateProfile } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    firstName: currentUser?.profile?.firstName || "",
    lastName: currentUser?.profile?.lastName || "",
    bio: currentUser?.profile?.bio || "",
    phone: currentUser?.profile?.phone || "",
  });

  const handleInputChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await updateProfile(formData);
      setIsEditing(false);
    } catch (error) {
      console.error("Error updating profile:", error);
    }
  };

  const getInitials = (user) => {
    if (user?.profile?.firstName || user?.profile?.lastName) {
      return `${user?.profile?.firstName?.[0] || ""}${
        user?.profile?.lastName?.[0] || ""
      }`;
    }
    return user?.username?.[0]?.toUpperCase() || "U";
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold">Profile</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            ✕
          </button>
        </div>

        <div className="text-center mb-6">
          <div className="w-20 h-20 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center text-white font-semibold text-2xl mx-auto mb-3">
            {getInitials(currentUser)}
          </div>
          <h3 className="font-semibold text-lg">{currentUser?.username}</h3>
          <p className="text-gray-600 text-sm">{currentUser?.email}</p>
        </div>

        {isEditing ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <input
                type="text"
                name="firstName"
                placeholder="First Name"
                value={formData.firstName}
                onChange={handleInputChange}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="text"
                name="lastName"
                placeholder="Last Name"
                value={formData.lastName}
                onChange={handleInputChange}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <input
              type="tel"
              name="phone"
              placeholder="Phone Number"
              value={formData.phone}
              onChange={handleInputChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <textarea
              name="bio"
              placeholder="Bio"
              value={formData.bio}
              onChange={handleInputChange}
              rows="3"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex space-x-3">
              <button
                type="submit"
                className="flex-1 bg-blue-500 text-white py-2 rounded-lg hover:bg-blue-600"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="flex-1 bg-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-400"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="border-b pb-2">
              <label className="text-sm text-gray-600">Name</label>
              <p className="font-medium">
                {currentUser?.profile?.firstName ||
                currentUser?.profile?.lastName
                  ? `${currentUser?.profile?.firstName || ""} ${
                      currentUser?.profile?.lastName || ""
                    }`.trim()
                  : "Not set"}
              </p>
            </div>
            <div className="border-b pb-2">
              <label className="text-sm text-gray-600">Phone</label>
              <p className="font-medium">
                {currentUser?.profile?.phone || "Not set"}
              </p>
            </div>
            <div className="border-b pb-2">
              <label className="text-sm text-gray-600">Bio</label>
              <p className="font-medium">
                {currentUser?.profile?.bio || "No bio added"}
              </p>
            </div>
            <button
              onClick={() => setIsEditing(true)}
              className="w-full bg-blue-500 text-white py-2 rounded-lg hover:bg-blue-600"
            >
              Edit Profile
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Profile;
