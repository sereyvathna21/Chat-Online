import React, { createContext, useContext, useState, useEffect } from "react";
import axios from "axios";

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("token");
    const userData = localStorage.getItem("userData");

    if (token && userData) {
      try {
        const user = JSON.parse(userData);
        setCurrentUser({ ...user, token });
        axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;
      } catch (err) {
        localStorage.removeItem("token");
        localStorage.removeItem("userData");
      }
    }
    setLoading(false);
  }, []);

  const login = async (email, password) => {
    try {
      setError("");
      const res = await axios.post("http://localhost:2000/api/auth/login", {
        email,
        password,
      });

      const { token, user } = res.data;

      localStorage.setItem("token", token);
      localStorage.setItem("userData", JSON.stringify(user));

      setCurrentUser({ ...user, token });
      axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;

      return true;
    } catch (err) {
      setError(err.response?.data?.error || "Login failed");
      return false;
    }
  };

  const register = async (username, email, password, profile = {}) => {
    try {
      setError("");
      const res = await axios.post("http://localhost:2000/api/auth/register", {
        username,
        email,
        password,
        profile,
      });

      const { token, user } = res.data;

      localStorage.setItem("token", token);
      localStorage.setItem("userData", JSON.stringify(user));

      setCurrentUser({ ...user, token });
      axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;

      return true;
    } catch (err) {
      setError(err.response?.data?.error || "Registration failed");
      return false;
    }
  };

  const updateProfile = async (profileData) => {
    try {
      setError("");
      const res = await axios.put("http://localhost:2000/api/auth/profile", {
        profile: profileData,
      });

      const updatedUser = { ...currentUser, profile: res.data.user.profile };
      setCurrentUser(updatedUser);
      localStorage.setItem("userData", JSON.stringify(updatedUser));

      return true;
    } catch (err) {
      setError(err.response?.data?.error || "Profile update failed");
      return false;
    }
  };

  const logout = async () => {
    try {
      await axios.post("http://localhost:2000/api/auth/logout");
    } catch (err) {
      console.error("Logout error:", err);
    } finally {
      localStorage.removeItem("token");
      localStorage.removeItem("userData");
      delete axios.defaults.headers.common["Authorization"];
      setCurrentUser(null);
    }
  };

  const value = {
    currentUser,
    loading,
    error,
    login,
    register,
    updateProfile,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
