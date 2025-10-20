import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

const prisma = new PrismaClient();

// OLD: Hardcoded list - keeping as fallback
const MIGRATED_MEMES_FALLBACK = [
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

async function main() {
  console.log('🌱 Seeding database...\n');

  // Step 1: Create admin user
  const adminPassword = 'PJio7cmV0IDYasFc$$';
  const hashedPassword = await bcrypt.hash(adminPassword, 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@ctomemes.xyz' },
    update: {},
    create: {
      email: 'admin@ctomemes.xyz',
      name: 'Admin',
      passwordHash: hashedPassword,
      role: 'ADMIN',
    },
  });

  console.log('✅ Admin user created:');
  console.log(`   Email: ${admin.email}`);
  console.log(`   Password: ${adminPassword}`);
  console.log(`   Role: ${admin.role}\n`);

  // Step 2: Import ALL memes from S3
  console.log('📥 Importing memes from S3...\n');

  const region = process.env.AWS_REGION || 'eu-north-1';
  const bucket = process.env.AWS_S3_BUCKET_NAME || 'baze-bucket';
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  let imported = 0;
  let skipped = 0;

  try {
    // Try to fetch from S3
    if (accessKeyId && secretAccessKey) {
      const s3 = new S3Client({
        region,
        credentials: { accessKeyId, secretAccessKey },
      });

      const listCommand = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: 'memes/',
      });

      const response = await s3.send(listCommand);
      const objects = response.Contents || [];

      console.log(`🔍 Found ${objects.length} objects in S3\n`);

      for (const obj of objects) {
        if (!obj.Key || obj.Key === 'memes/' || obj.Size === 0) continue;

        try {
          const existing = await prisma.meme.findUnique({ where: { s3Key: obj.Key } });
          if (existing) {
            skipped++;
            continue;
          }

          // Extract filename
          const keyParts = obj.Key.split('/');
          const fullFilename = keyParts[keyParts.length - 1];
          let filename = fullFilename;
          const match = fullFilename.match(/(.+)_\d+(\.\w+)$/);
          if (match) filename = match[1] + match[2];

          // Determine mime type
          const ext = fullFilename.split('.').pop()?.toLowerCase() || '';
          let mimeType = 'image/jpeg';
          if (ext === 'png') mimeType = 'image/png';
          if (ext === 'gif') mimeType = 'image/gif';
          if (ext === 'webp') mimeType = 'image/webp';

          const s3Url = `https://${bucket}.s3.${region}.amazonaws.com/${obj.Key}`;

          await prisma.meme.create({
            data: {
              filename,
              s3Key: obj.Key,
              s3Url,
              size: obj.Size || 0,
              mimeType,
              uploadedById: admin.id,
            },
          });

          imported++;
        } catch {}
      }
    } else {
      console.log('⚠️  AWS credentials not available, skipping S3 import\n');
    }
  } catch (error) {
    console.log('⚠️  S3 import failed, continuing without memes\n');
  }

  console.log(`✅ Imported ${imported} memes (${skipped} already existed)\n`);
  console.log('🎉 Seeding complete!\n');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

