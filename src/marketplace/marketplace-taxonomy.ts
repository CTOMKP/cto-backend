export type MarketplacePostTypeValue = 'LOOKING_FOR' | 'OFFERING';

export type MarketplaceSubcategoryDefinition = {
  id: string;
  name: string;
  priceUsd: number;
  aliases?: string[];
  active?: boolean;
};

export type MarketplaceCategoryDefinition = {
  id: string;
  name: string;
  defaultPriceUsd: number;
  postTypes: MarketplacePostTypeValue[];
  defaultPostType: MarketplacePostTypeValue;
  aliases?: string[];
  subcategories: MarketplaceSubcategoryDefinition[];
};

const sub = (id: string, name: string, priceUsd: number, aliases: string[] = []): MarketplaceSubcategoryDefinition => ({
  id,
  name,
  priceUsd,
  aliases,
  active: true,
});

export const MARKETPLACE_TAXONOMY: MarketplaceCategoryDefinition[] = [
  {
    id: 'developers', name: 'Developers', defaultPriceUsd: 25,
    postTypes: ['LOOKING_FOR', 'OFFERING'], defaultPostType: 'LOOKING_FOR',
    aliases: ['Development Services'],
    subcategories: [
      sub('smart-contract-dev', 'Smart Contract Dev', 25, ['Smart Contract Developer']),
      sub('frontend-dev', 'Frontend Dev', 25, ['UI Engineer']),
      sub('backend-dev', 'Backend Dev', 25),
      sub('fullstack-web3-developer', 'Full Stack / Fullstack Web3 Developer', 25, ['Full Stack', 'Full Stack Developer', 'Web3 Developer']),
      sub('blockchain-integration', 'Blockchain Integration', 25),
      sub('bot-developer', 'Bot Developer', 25),
      sub('solidity-move-specialist', 'Solidity / Move Specialist', 25, ['Solidity Developer', 'Move Developer']),
      sub('security-auditor', 'Security Auditor', 25),
      sub('dapp-builder', 'DApp Builder', 25),
      sub('proxy-upgradeable-contract-developer', 'Proxy / Upgradeable Contract Developer', 25),
      sub('token-contract-launch-developer', 'Token Contract Launch Developer', 25),
      sub('telegram-discord-bot-developer', 'Telegram / Discord Bot Developer', 25),
      sub('3d-nft-artist-legacy', '3D / NFT Artist', 15),
    ],
  },
  {
    id: 'design-branding', name: 'Design & Branding', defaultPriceUsd: 15,
    postTypes: ['LOOKING_FOR', 'OFFERING'], defaultPostType: 'LOOKING_FOR',
    aliases: ['Designers', 'Design & Creative'],
    subcategories: [
      sub('ui-ux-designer', 'UI/UX Designer', 15),
      sub('graphic-designer', 'Graphic Designer', 15),
      sub('motion-designer', 'Motion Designer', 15),
      sub('meme-designer', 'Meme Designer', 15),
      sub('branding-strategist', 'Branding Strategist', 15),
      sub('branding-logo-designer', 'Branding / Logo Designer', 15, ['Logo Designer']),
      sub('custom-logo-rebranding', 'Custom Logo / Rebranding', 15),
      sub('website-ui-kits', 'Website UI Kits', 15),
      sub('meme-packs', 'Meme Packs', 15),
    ],
  },
  {
    id: 'shilling-marketing', name: 'Shilling & Marketing', defaultPriceUsd: 20,
    postTypes: ['LOOKING_FOR', 'OFFERING'], defaultPostType: 'LOOKING_FOR',
    aliases: ['Marketers & Promoters', 'Marketing & Hype'],
    subcategories: [
      sub('shillers', 'Shillers', 20),
      sub('influencer-outreach', 'Influencer Outreach', 20, ['Influencer/KOL Outreach']),
      sub('growth-hacker', 'Growth Hacker', 20),
      sub('social-media-manager', 'Social Media Manager', 20),
      sub('paid-ads-campaign', 'Paid Ads / Campaign', 20),
      sub('meme-creator', 'Meme Creator', 20),
      sub('thread-writer', 'Thread Writer', 20),
      sub('hype-thread-writer', 'Hype Thread Writer', 20, ['Hype Thread / Copywriter']),
      sub('x-twitter-hype-team', 'X / Twitter Hype Team', 20),
      sub('space-host-co-host', 'Space Host / Co-Host', 20),
      sub('influencer-listing', 'Influencer Listing', 20),
      sub('social-media-engagement', 'Social Media Engagement', 20),
    ],
  },
  {
    id: 'tokenomics-strategy', name: 'Tokenomics & Strategy', defaultPriceUsd: 10,
    postTypes: ['LOOKING_FOR', 'OFFERING'], defaultPostType: 'LOOKING_FOR',
    subcategories: [
      sub('tokenomics-analyst', 'Tokenomics Analyst', 10),
      sub('on-chain-economist', 'On-chain Economist', 10),
      sub('project-strategist', 'Project Strategist', 10),
      sub('dao-architect', 'DAO Architect', 10),
      sub('revenue-model-planner', 'Revenue Model Planner', 10),
      sub('tokenomics-review', 'Tokenomics Review', 10),
      sub('project-strategy-growth-plan', 'Project Strategy & Growth Plan', 10),
    ],
  },
  {
    id: 'advisory-leadership', name: 'Advisory & Leadership', defaultPriceUsd: 10,
    postTypes: ['LOOKING_FOR', 'OFFERING'], defaultPostType: 'LOOKING_FOR',
    aliases: ['Education & Advisory'],
    subcategories: [
      sub('cto-advisor', 'CTO', 10),
      sub('founder-cofounder', 'Founder / Co-founder', 10),
      sub('advisor', 'Advisor', 10),
      sub('moderator-lead', 'Moderator Lead', 10),
      sub('project-manager', 'Project Manager', 10),
      sub('community-dao-lead', 'Community DAO Lead', 10),
      sub('web3-onboarding', 'Web3 Onboarding', 10),
      sub('community-setup-advice', 'Community Setup Advice', 10),
    ],
  },
  {
    id: 'community-operations', name: 'Community & Operations', defaultPriceUsd: 10,
    postTypes: ['LOOKING_FOR', 'OFFERING'], defaultPostType: 'LOOKING_FOR',
    aliases: ['Community Roles'],
    subcategories: [
      sub('telegram-discord-mod', 'Telegram / Discord Mod', 10, ['Telegram Admin', 'Discord Mod']),
      sub('admin-support', 'Admin / Support', 10),
      sub('community-builder', 'Community Builder', 10),
      sub('partnerships-manager', 'Partnerships Manager', 10),
      sub('event-organizer', 'Event Organizer', 10),
      sub('hr-team-coordinator', 'HR / Team Coordinator', 10),
      sub('community-manager', 'Community Manager', 10),
      sub('dao-facilitator', 'DAO Facilitator', 10),
      sub('onboarding-education-lead', 'Onboarding / Education Lead', 10),
    ],
  },
  {
    id: 'project-takeovers', name: 'Project Listings (For Takeover)', defaultPriceUsd: 40,
    postTypes: ['LOOKING_FOR'], defaultPostType: 'LOOKING_FOR',
    aliases: ['CTO Wanted', 'project-listings'],
    subcategories: [
      sub('cto-wanted', 'CTO Wanted', 40),
      sub('rugged-project-revival', 'Rugged Project Revival', 40, ['Recently Rugged']),
      sub('builder-wanted', 'Builder Wanted', 25),
      sub('partnership-requests', 'Partnership Requests', 15),
      sub('dao-takeover', 'DAO Takeover', 40),
      sub('new-meme-launch', 'New Meme Launch', 25),
    ],
  },
  {
    id: 'nft-art', name: 'NFT & Art', defaultPriceUsd: 15,
    postTypes: ['LOOKING_FOR', 'OFFERING'], defaultPostType: 'LOOKING_FOR',
    subcategories: [
      sub('nft-artist', 'NFT Artist', 15),
      sub('3d-nft-artist', '3D / NFT Artist', 15),
      sub('3d-animator', '3D Animator', 15),
      sub('concept-artist', 'Concept Artist', 15),
      sub('collection-manager', 'Collection Manager', 15),
      sub('nft-strategist', 'NFT Strategist', 15),
      sub('nft-collection-commission', 'NFT Collection Commission', 15),
    ],
  },
  {
    id: 'tools-services', name: 'Tools & Services', defaultPriceUsd: 10,
    postTypes: ['OFFERING'], defaultPostType: 'OFFERING',
    aliases: ['Tools & Assets'],
    subcategories: [
      sub('analytics-tools', 'Analytics Tools', 10),
      sub('security-audit-service', 'Security / Audit Service', 25),
      sub('launchpad-service', 'Launchpad Service', 10),
      sub('automation-api', 'Automation / API', 10),
      sub('dev-tool-plugin', 'Dev Tool / Plugin', 10),
      sub('marketing-tool', 'Marketing Tool', 10),
      sub('telegram-sniper-bot', 'Telegram Sniper Bot', 10),
      sub('chart-alert-bot', 'Chart / Alert Bot', 10),
      sub('custom-analytics-dashboard', 'Custom Analytics Dashboard', 10),
      sub('starter-kit-template-pack', 'Starter Kit / Template Pack', 10),
      sub('telegram-discord-bot-service', 'Telegram / Discord Bot Service', 25),
      sub('dapp-build-service', 'DApp Build Service', 25),
      sub('proxy-upgradeable-contract-service', 'Proxy / Upgradeable Contract Service', 25),
      sub('token-contract-launch-service', 'Token Contract Launch Service', 25),
    ],
  },
  {
    id: 'writing-content', name: 'Writing & Content', defaultPriceUsd: 10,
    postTypes: ['LOOKING_FOR', 'OFFERING'], defaultPostType: 'LOOKING_FOR',
    subcategories: [
      sub('copywriter', 'Copywriter', 20),
      sub('whitepaper-writer', 'Whitepaper Writer', 10),
      sub('meme-writer', 'Meme Writer', 20),
      sub('community-announcer', 'Community Announcer', 20),
      sub('script-writer', 'Script Writer', 20),
      sub('translator', 'Translator', 10),
    ],
  },
  {
    id: 'collaborations-partnerships', name: 'Collaborations & Partnerships', defaultPriceUsd: 15,
    postTypes: ['LOOKING_FOR'], defaultPostType: 'LOOKING_FOR',
    subcategories: [
      sub('partner-project-search', 'Partner Project Search', 15),
      sub('cross-promo-request', 'Cross-Promo Request', 15),
      sub('co-launch-inquiry', 'Co-Launch Inquiry', 15),
      sub('strategic-collaboration', 'Strategic Collaboration', 15),
    ],
  },
  {
    id: 'other-experimental', name: 'Other / Experimental', defaultPriceUsd: 0,
    postTypes: ['LOOKING_FOR', 'OFFERING'], defaultPostType: 'LOOKING_FOR',
    subcategories: [
      sub('miscellaneous-services', 'Miscellaneous Services', 0, ['Misc Services']),
      sub('suggest-new-category', 'Suggest New Category', 0),
    ],
  },
];

export const MARKETPLACE_ADDONS = [
  { id: 'FEATURED_PLACEMENT', name: 'Featured Placement', priceUsd: 20 },
  { id: 'HOMEPAGE_SPOTLIGHT', name: 'Homepage Spotlight', priceUsd: 35 },
  { id: 'AUTO_BUMP_1', name: 'Auto-Bump - 1 Day', priceUsd: 3 },
  { id: 'AUTO_BUMP_3', name: 'Auto-Bump - 3 Days', priceUsd: 7 },
  { id: 'AUTO_BUMP_7', name: 'Auto-Bump - 7 Days', priceUsd: 15 },
  { id: 'MULTI_CHAIN_TAG', name: 'Multi-Chain Tag Unlock', priceUsd: 5 },
  { id: 'URGENT_TAG', name: 'Urgent Tag', priceUsd: 5 },
];

export const MARKETPLACE_TAG_GROUPS = {
  blockchain: ['Aptos', 'Solana', 'Ethereum', 'Base', 'Polygon', 'BSC', 'Sui', 'TON', 'EVM', 'Multi-Chain'],
  urgency: ['Urgent', 'ASAP', 'Need Today'],
  compensation: ['Free', 'Bounty', 'Paid', 'Rev Share', 'Low Budget'],
  skillLevel: ['Beginner Friendly', 'Expert Only', 'No Code'],
  project: ['CTO Project', 'NFT-Backed', 'DAO', 'Memecoin', 'Rebrand'],
};

export const MARKETPLACE_VISIBILITY_BUNDLES = [
  { id: 'PRO_BOOST', name: 'Pro Boost Bundle', priceUsd: 35, addonIds: ['FEATURED_PLACEMENT', 'AUTO_BUMP_3', 'MULTI_CHAIN_TAG'] },
  { id: 'SPOTLIGHT_HERO', name: 'Spotlight Hero', priceUsd: 50, addonIds: ['HOMEPAGE_SPOTLIGHT', 'FEATURED_PLACEMENT'] },
  { id: 'ULTIMATE_VISIBILITY', name: 'Ultimate Visibility', priceUsd: 65, addonIds: ['HOMEPAGE_SPOTLIGHT', 'FEATURED_PLACEMENT', 'AUTO_BUMP_7', 'MULTI_CHAIN_TAG'] },
];
