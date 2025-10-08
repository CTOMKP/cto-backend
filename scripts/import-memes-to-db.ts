/**
 * Import migrated memes from S3 into database
 * Run: npx ts-node scripts/import-memes-to-db.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// The 27 migrated memes from S3
const MIGRATED_MEMES = [
  { filename: "make_it_rain.jpg", s3Key: "memes/make_it_rain_1759861994189.jpg", size: 1948877, mimeType: "image/jpeg" },
  { filename: "in_for_launch.jpg", s3Key: "memes/in_for_launch_1759862013981.jpg", size: 1717367, mimeType: "image/jpeg" },
  { filename: "Bullish.jpg", s3Key: "memes/Bullish_1759862027472.jpg", size: 59836, mimeType: "image/jpeg" },
  { filename: "profits_1757215128068.PNG", s3Key: "memes/profits_1757215128068_1759862043238.PNG", size: 1996809, mimeType: "image/png" },
  { filename: "grape_kong.jpg", s3Key: "memes/grape_kong_1759862064898.jpg", size: 2367732, mimeType: "image/jpeg" },
  { filename: "gate_keeping.jpg", s3Key: "memes/gate_keeping_1759862084663.jpg", size: 1848743, mimeType: "image/jpeg" },
  { filename: "Look_what_we_have_here.jpg", s3Key: "memes/Look_what_we_have_here_1759862098282.jpg", size: 1450600, mimeType: "image/jpeg" },
  { filename: "coming_through.jpg", s3Key: "memes/coming_through_1759862119095.jpg", size: 2293337, mimeType: "image/jpeg" },
  { filename: "no_bear_allowed_1757213078073.PNG", s3Key: "memes/no_bear_allowed_1757213078073_1759862140855.PNG", size: 1977462, mimeType: "image/png" },
  { filename: "the_pump_1757215139795.PNG", s3Key: "memes/the_pump_1757215139795_1759862158725.PNG", size: 1774365, mimeType: "image/png" },
  { filename: "grapes_teller.jpg", s3Key: "memes/grapes_teller_1759862176356.jpg", size: 1563221, mimeType: "image/jpeg" },
  { filename: "cto_1757211729499.PNG", s3Key: "memes/cto_1757211729499_1759862199421.PNG", size: 2225350, mimeType: "image/png" },
  { filename: "double_the_stakes.jpg", s3Key: "memes/double_the_stakes_1759862219681.jpg", size: 1807258, mimeType: "image/jpeg" },
  { filename: "its_a_wrap_1757211359320.PNG", s3Key: "memes/its_a_wrap_1757211359320_1759862232570.PNG", size: 1231506, mimeType: "image/png" },
  { filename: "kika_CTO_1757211888287.PNG", s3Key: "memes/kika_CTO_1757211888287_1759862254223.PNG", size: 2564232, mimeType: "image/png" },
  { filename: "that_way_1757212070301.PNG", s3Key: "memes/that_way_1757212070301_1759862273514.PNG", size: 1636499, mimeType: "image/png" },
  { filename: "monitor_the_charts.jpg", s3Key: "memes/monitor_the_charts_1759862290972.jpg", size: 1721698, mimeType: "image/jpeg" },
  { filename: "write_the_charts_1757215170452.PNG", s3Key: "memes/write_the_charts_1757215170452_1759862311139.PNG", size: 1772868, mimeType: "image/png" },
  { filename: "chess_1757215205297.PNG", s3Key: "memes/chess_1757215205297_1759862327124.PNG", size: 1461058, mimeType: "image/png" },
  { filename: "graptrix.jpg", s3Key: "memes/graptrix_1759862346370.jpg", size: 1448246, mimeType: "image/jpeg" },
  { filename: "chef_habibi_1757212174228.PNG", s3Key: "memes/chef_habibi_1757212174228_1759862366436.PNG", size: 2177987, mimeType: "image/png" },
  { filename: "grab_it_1757211121412.PNG", s3Key: "memes/grab_it_1757211121412_1759862390513.PNG", size: 2283707, mimeType: "image/png" },
  { filename: "grapes_cooking.jpg", s3Key: "memes/grapes_cooking_1759862407916.jpg", size: 1718417, mimeType: "image/jpeg" },
  { filename: "alot_to_do.jpg", s3Key: "memes/alot_to_do_1759862428160.jpg", size: 2317798, mimeType: "image/jpeg" },
  { filename: "grape_fries_1757215228535.PNG", s3Key: "memes/grape_fries_1757215228535_1759862450635.PNG", size: 2435879, mimeType: "image/png" },
  { filename: "money_made.jpg", s3Key: "memes/money_made_1759862466659.jpg", size: 1583720, mimeType: "image/jpeg" },
  { filename: "roll_the_dice_1757212826405.PNG", s3Key: "memes/roll_the_dice_1757212826405_1759862485472.PNG", size: 1983207, mimeType: "image/png" },
];

async function importMemes() {
  console.log('📥 Importing 27 migrated memes into database...\n');

  // Get admin user ID
  const admin = await prisma.user.findUnique({
    where: { email: 'admin@ctomemes.xyz' },
  });

  if (!admin) {
    console.error('❌ Admin user not found! Run seed first: npx prisma db seed');
    process.exit(1);
  }

  console.log(`✅ Admin user found: ${admin.email} (ID: ${admin.id})\n`);

  let imported = 0;
  let skipped = 0;

  for (const meme of MIGRATED_MEMES) {
    try {
      // Check if already exists
      const existing = await prisma.meme.findUnique({
        where: { s3Key: meme.s3Key },
      });

      if (existing) {
        console.log(`⏭️  Skipped: ${meme.filename} (already exists)`);
        skipped++;
        continue;
      }

      // Create meme record
      const region = process.env.AWS_REGION || 'eu-north-1';
      const bucket = process.env.AWS_S3_BUCKET_NAME || 'baze-bucket';
      const s3Url = `https://${bucket}.s3.${region}.amazonaws.com/${meme.s3Key}`;

      await prisma.meme.create({
        data: {
          filename: meme.filename,
          s3Key: meme.s3Key,
          s3Url: s3Url,
          size: meme.size,
          mimeType: meme.mimeType,
          uploadedById: admin.id,
        },
      });

      console.log(`✅ Imported: ${meme.filename}`);
      imported++;
    } catch (error) {
      console.error(`❌ Failed to import ${meme.filename}:`, error instanceof Error ? error.message : 'Unknown error');
      skipped++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 Import Summary:');
  console.log('='.repeat(60));
  console.log(`✅ Imported: ${imported}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  console.log(`📝 Total: ${MIGRATED_MEMES.length}`);
  console.log('\n🎉 Import complete!\n');
}

importMemes()
  .catch((e) => {
    console.error('❌ Import failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

