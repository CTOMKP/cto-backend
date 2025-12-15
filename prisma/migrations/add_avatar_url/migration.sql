-- Add avatarUrl field to User table
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT;

