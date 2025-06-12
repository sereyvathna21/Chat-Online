import React from "react";
import Chat from "./components/Chat";
import Login from "./components/Login";
import { AuthProvider, useAuth } from "./context/AuthContext";

const ChatApp = () => {
  const { currentUser, loading, logout } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden">
      {currentUser ? (
        <div className="relative h-full">
          <button
            onClick={logout}
            className="absolute top-4 right-4 z-10 bg-red-500 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-600 transition-colors"
          >
            Logout
          </button>
          <Chat />
        </div>
      ) : (
        <Login />
      )}
    </div>
  );
};

function App() {
  return (
    <AuthProvider>
      <ChatApp />
    </AuthProvider>
  );
}

export default App;
