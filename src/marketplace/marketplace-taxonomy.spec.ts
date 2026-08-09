import {
  MARKETPLACE_ADDONS,
  MARKETPLACE_TAXONOMY,
  MARKETPLACE_VISIBILITY_BUNDLES,
} from './marketplace-taxonomy';

describe('marketplace taxonomy and pricing specification', () => {
  it('exposes the 12 stable canonical category IDs', () => {
    expect(MARKETPLACE_TAXONOMY.map((category) => category.id)).toEqual([
      'developers',
      'design-branding',
      'shilling-marketing',
      'tokenomics-strategy',
      'advisory-leadership',
      'community-operations',
      'project-takeovers',
      'nft-art',
      'tools-services',
      'writing-content',
      'collaborations-partnerships',
      'other-experimental',
    ]);
  });

  it('provides explicit subcategory prices and supported post types', () => {
    for (const category of MARKETPLACE_TAXONOMY) {
      expect(category.postTypes.length).toBeGreaterThan(0);
      expect(category.subcategories.length).toBeGreaterThan(0);
      for (const subcategory of category.subcategories) {
        expect(subcategory.id).toBeTruthy();
        expect(subcategory.priceUsd).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('matches the approved add-on prices and keeps example bundles separate', () => {
    expect(Object.fromEntries(MARKETPLACE_ADDONS.map((addon) => [addon.id, addon.priceUsd]))).toEqual({
      FEATURED_PLACEMENT: 20,
      HOMEPAGE_SPOTLIGHT: 35,
      AUTO_BUMP_1: 3,
      AUTO_BUMP_3: 7,
      AUTO_BUMP_7: 15,
      MULTI_CHAIN_TAG: 5,
      URGENT_TAG: 5,
    });
    expect(MARKETPLACE_VISIBILITY_BUNDLES).toHaveLength(3);
  });
});
