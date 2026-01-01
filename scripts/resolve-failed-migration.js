#!/usr/bin/env node
/**
 * Resolve failed migration: 20250101_add_vetted_field
 * 
 * This script marks the failed migration as applied since the column already exists.
 * Run this in Coolify's post-deployment command or manually via terminal.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function resolveFailedMigration() {
  try {
    console.log('🔍 Checking migration status...');
    
    // Check if the vetted column exists
    const columnExists = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'Listing' 
        AND column_name = 'vetted'
      ) as exists
    `;
    
    const exists = columnExists[0]?.exists;
    
    if (!exists) {
      console.log('❌ Column "vetted" does not exist. Cannot mark migration as applied.');
      process.exit(1);
    }
    
    console.log('✅ Column "vetted" exists. Marking migration as applied...');
    
    // Mark the failed migration as applied
    await prisma.$executeRaw`
      UPDATE "_prisma_migrations"
      SET 
        "finished_at" = NOW(),
        "applied_steps_count" = 1,
        "logs" = NULL
      WHERE "migration_name" = '20250101_add_vetted_field'
      AND "finished_at" IS NULL
    `;
    
    console.log('✅ Migration marked as applied successfully!');
    
    // Verify
    const migration = await prisma.$queryRaw`
      SELECT "migration_name", "finished_at", "applied_steps_count"
      FROM "_prisma_migrations"
      WHERE "migration_name" = '20250101_add_vetted_field'
    `;
    
    console.log('📋 Migration status:', migration[0]);
    
  } catch (error) {
    console.error('❌ Error resolving migration:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

resolveFailedMigration();

