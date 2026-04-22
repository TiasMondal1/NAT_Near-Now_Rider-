/**
 * Authentication Service for Delivery Partner App
 * Based on customer app implementation
 */

import { API_CONFIG } from "../constants/config";

export interface AppUser {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: 'customer' | 'shopkeeper' | 'delivery_partner';
  isActivated: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface AuthResponse {
  user: AppUser;
  token: string;
}

const getApiBase = () => API_CONFIG.BASE_URL;

export async function sendOTP(phone: string): Promise<void> {
  const apiBase = getApiBase();
  const url = `${apiBase}/api/auth/send-otp`;

  console.log('📱 Sending OTP to:', url);
  console.log('📞 Phone:', phone);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  });

  if (!response.ok) {
    let message = 'Failed to send OTP';
    try {
      const text = await response.text();
      console.error('❌ Response:', text.substring(0, 200));
      try {
        const error = JSON.parse(text);
        message = error.message || error.error || message;
      } catch {
        if (text.includes('<!DOCTYPE') || text.includes('<html')) {
          message = 'Backend API not configured. Server returned HTML instead of JSON.';
        } else if (text) {
          message = text;
        }
      }
    } catch {}
    throw new Error(message);
  }

  console.log('✅ OTP sent successfully');
}

export async function verifyOTP(
  phone: string,
  otp: string,
  name = 'Delivery Partner',
): Promise<AuthResponse> {
  const apiBase = getApiBase();
  const url = `${apiBase}/api/auth/verify-otp`;

  console.log('🔐 Verifying OTP at:', url);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, otp: String(otp).trim(), name }),
  });

  const text = await response.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    console.error('❌ Failed to parse response:', text.substring(0, 200));
    data = {};
  }

  if (!response.ok) {
    const message = data.message || data.error || 'Invalid OTP';
    throw new Error(String(message));
  }

  if (!data.user || !data.token) {
    throw new Error('Invalid response from server');
  }

  console.log('✅ OTP verified successfully');

  return {
    user: data.user as AppUser,
    token: data.token,
  };
}
