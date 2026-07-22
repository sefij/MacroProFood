export const ITSU_PRODUCT_QUERY = `query DynamicPage($uri: String!, $path: String!, $site: String!, $locale: I18NLocaleCode!) {
  ...Redirect
  ...Page
}

fragment Page on Query {
  pages(
    filters: {uri: {eq: $uri}, site: {domain: {eq: $site}}}
    pagination: {pageSize: 1}
    locale: $locale
  ) {
    documentId
    locale
    localizations {
      locale
      uri
    }
    title
    uri
    seo {
      ...PageSeo
    }
    components {
      __typename
      ...PageSections
      ...PageTemplates
    }
    publishedAt
    age_gate
  }
}

fragment PageSections on PageComponentsDynamicZone {
  ... on ComponentPageSectionsDoubleCtaSection {
    ...DoubleCtaSection
  }
  ... on ComponentPageSectionsHorizontalTextImageSection {
    ...HorizontalTextImageSection
  }
  ... on ComponentPageSectionsVerticalTextImageSection {
    ...VerticalTextImageSection
  }
  ... on ComponentPageSectionsThreeColumnGridSection {
    ...ThreeColumnGridSection
  }
  ... on ComponentPageSectionsFourColumnGridSection {
    ...FourColumnGridSection
  }
  ... on ComponentPageSectionsMenuCarouselSection {
    ...MenuCarouselSection
  }
  ... on ComponentPageSectionsGroceryCarouselSection {
    ...GroceryCarouselSection
  }
  ... on ComponentPageSectionsGroceryListingsSection {
    ...GroceryListingsSection
  }
  ... on ComponentPageSectionsHeroBannerSection {
    ...HeroBannerSection
  }
  ... on ComponentPageSectionsSecondaryNavSection {
    ...SecondaryNavSection
  }
  ... on ComponentPageSectionsHorizontalBgTextImageSection {
    ...HorizontalBackgroundTextImageSection
  }
  ... on ComponentPageSectionsHorizontalImageCtaSection {
    ...HorizontalImageCtaSection
  }
  ... on ComponentPageSectionsImageBannerSection {
    ...ImageBannerSection
  }
  ... on ComponentPageSectionsPatternedHeroSection {
    ...PatternedHeroSection
  }
  ... on ComponentPageSectionsUserLocationSection {
    ...UserLocationSection
  }
  ... on ComponentPageSectionsOurTeamSection {
    ...OurTeamSection
  }
  ... on ComponentPageSectionsHeadingImageSection {
    ...HeadingImageSection
  }
  ... on ComponentPageSectionsVideoHeroSection {
    ...VideoHeroSection
  }
  ... on ComponentPageSectionsContentDividerSection {
    ...ContentDividerSection
  }
  ... on ComponentPageSectionsOurOpportunitiesSection {
    ...OurOpportunitiesSection
  }
  ... on ComponentPageSectionsRestaurantsMapSection {
    ...RestaurantsMapSection
  }
  ... on ComponentPageSectionsBasicBackgroundHeroSection {
    ...BasicBackgroundHeroSection
  }
  ... on ComponentPageSectionsRestaurantDetailsSection {
    ...RestaurantDetailsSection
  }
  ... on ComponentPageSectionsTextCarouselSection {
    ...TextCarouselSection
  }
  ... on ComponentPageSectionsRetailerLogosGridSection {
    ...RetailerLogosGridSection
  }
  ... on ComponentPageSectionsTextHeroSection {
    ...TextHeroSection
  }
  ... on ComponentPageSectionsStoresMapSection {
    ...StoresMapSection
  }
  ... on ComponentPageSectionsBonusRecipeCarouselSection {
    ...BonusRecipeCarouselSection
  }
  ... on ComponentPageSectionsFaqSection {
    ...FaqsSection
  }
  ... on ComponentPageSectionsSitemapSection {
    ...SitemapSection
  }
  ... on ComponentPageSectionsContactFormSection {
    ...ContactFormSection
  }
  ... on ComponentPageSectionsRestaurantsCarouselSection {
    ...RestaurantsCarouselSection
  }
  ... on ComponentPageSectionsBasicTextSection {
    ...BasicTextSection
  }
  ... on ComponentPageSectionsCollapsibleContentSection {
    ...CollapsibleContentSection
  }
  ... on ComponentPageSectionsJobCategoriesSection {
    ...JobCategoriesSection
  }
  ... on ComponentPageSectionsRecipeListingsSection {
    ...RecipeListingsSection
  }
  ... on ComponentPageSectionsAllItsuLocationsSection {
    ...AllItsuLocationsSection
  }
  ... on ComponentPageSectionsAreaRestaurantsListSection {
    ...AreaRestaurantsListSection
  }
  ... on ComponentPageSectionsNewsletterPreferencesSection {
    ...NewsletterPreferencesSection
  }
  ... on ComponentPageSectionsProductRetailersMapSection {
    ...ProductRetailersMapSection
  }
  ... on ComponentPageSectionsCardColumnsSection {
    ...CardColumnsSection
  }
  ... on ComponentPageSectionsLandingPageFormSection {
    ...LandingPageFormSection
  }
  ... on ComponentPageSectionsMapSection {
    ...MapSection
  }
  ... on ComponentPageSectionsRegionChoiceSection {
    ...RegionChoiceSection
  }
  ... on ComponentPageSectionsRegionRetailersSection {
    ...RegionRetailersSection
  }
  ... on ComponentPageSectionsRegionFeaturedProductsSection {
    ...RegionFeaturedProductsSection
  }
  ... on ComponentPageSectionsMultipleImageCtaSection {
    ...MultipleImageCtaSection
  }
  ... on ComponentPageSectionsBreadcrumbsSection {
    ...BreadcrumbsSection
  }
  ... on ComponentPageSectionsLinkCardsSection {
    ...LinkCardsSection
  }
  ... on ComponentPageSectionsRestaurantReviewsWidgetSection {
    ...RestaurantReviewsWidgetSection
  }
}

fragment DoubleCtaSection on ComponentPageSectionsDoubleCtaSection {
  __typename
  id
  left_cta_title
  left_cta_text
  left_cta_image {
    ...StrapiImage
  }
  left_cta_button_1_text
  left_cta_button_1_link {
    ...StrapiPageLink
  }
  left_cta_button_1_link_external
  left_cta_button_2_text
  left_cta_button_2_link {
    ...StrapiPageLink
  }
  left_cta_button_2_link_external
  right_cta_title
  right_cta_text
  right_cta_image {
    ...StrapiImage
  }
  right_cta_button_1_text
  right_cta_button_1_link {
    ...StrapiPageLink
  }
  right_cta_button_1_link_external
  right_cta_button_2_text
  right_cta_button_2_link {
    ...StrapiPageLink
  }
  right_cta_button_2_link_external
}

fragment StrapiImage on UploadFile {
  alternativeText
  url
  width
  height
}

fragment StrapiPageLink on Page {
  uri
}

fragment HorizontalTextImageSection on ComponentPageSectionsHorizontalTextImageSection {
  __typename
  id
  horizontalTextImageSection_title: title
  text
  desktop_image {
    ...StrapiImage
  }
  mobile_image {
    ...StrapiImage
  }
  background_image {
    ...StrapiImage
  }
  horizontalTextImageSection_background_variant: background_variant
  reversed
  fluid_container
  text_column_width
}

fragment VerticalTextImageSection on ComponentPageSectionsVerticalTextImageSection {
  __typename
  id
  verticalTextImageSection_title: title
  text
  top_desktop_image {
    ...StrapiImage
  }
  top_mobile_image {
    ...StrapiImage
  }
  bottom_desktop_image {
    ...StrapiImage
  }
  bottom_mobile_image {
    ...StrapiImage
  }
  verticalTextImageSection_background_variant: background_variant
  fluid_container
  text_alignment
}

fragment ThreeColumnGridSection on ComponentPageSectionsThreeColumnGridSection {
  __typename
  id
  threeColumnGridSection_title: title
  threeColumnGridSection_column_1_image: column_1_image {
    ...StrapiImage
  }
  threeColumnGridSection_column_1_text: column_1_text
  threeColumnGridSection_column_2_image: column_2_image {
    ...StrapiImage
  }
  threeColumnGridSection_column_2_text: column_2_text
  threeColumnGridSection_column_3_image: column_3_image {
    ...StrapiImage
  }
  threeColumnGridSection_column_3_text: column_3_text
  threeColumnGridSection_background_variant: background_variant
  threeColumnGridSection_grid_type: grid_type
}

fragment FourColumnGridSection on ComponentPageSectionsFourColumnGridSection {
  __typename
  id
  fourColumnGridSection_title: title
  fourColumnGridSection_column_1_image: column_1_image {
    ...StrapiImage
  }
  fourColumnGridSection_column_1_text: column_1_text
  fourColumnGridSection_column_2_image: column_2_image {
    ...StrapiImage
  }
  fourColumnGridSection_column_2_text: column_2_text
  fourColumnGridSection_column_3_image: column_3_image {
    ...StrapiImage
  }
  fourColumnGridSection_column_3_text: column_3_text
  fourColumnGridSection_column_4_image: column_4_image {
    ...StrapiImage
  }
  fourColumnGridSection_column_4_text: column_4_text
  fourColumnGridSection_background_variant: background_variant
  fourColumnGridSection_grid_type: grid_type
}

fragment MenuCarouselSection on ComponentPageSectionsMenuCarouselSection {
  __typename
  id
  menuCarousel_title: title
  menuCarousel_button_text: button_text
  menuCarousel_button_link: button_link {
    ...StrapiPageLink
  }
  menuCarousel_show_navigation_buttons: show_navigation_buttons
  products(pagination: {pageSize: 9999}) {
    marketing_title
    calories
    website_product_image {
      ...StrapiImage
    }
    website_thumbnail_image {
      ...StrapiImage
    }
    page {
      ...StrapiPageLink
    }
  }
}

fragment GroceryCarouselSection on ComponentPageSectionsGroceryCarouselSection {
  __typename
  id
  groceryCarousel_title: title
  groceryCarousel_button_text: button_text
  groceryCarousel_button_link: button_link {
    ...StrapiPageLink
  }
  groceryCarousel_show_navigation_buttons: show_navigation_buttons
  grocery_products(pagination: {pageSize: 9999}) {
    marketing_title
    calories
    website_product_image {
      ...StrapiImage
    }
    website_thumbnail_image {
      ...StrapiImage
    }
    page {
      ...StrapiPageLink
    }
  }
}

fragment GroceryListingsSection on ComponentPageSectionsGroceryListingsSection {
  __typename
  id
  category {
    documentId
    name
    page {
      ...StrapiPageLink
    }
  }
  grocery_link {
    ...StrapiPageLink
  }
  dietary_labels(
    filters: {publishedAt: {notNull: true}}
    pagination: {pageSize: 9999}
  ) {
    name
    key
    icon {
      ...StrapiImage
    }
  }
  sort_labels(
    filters: {publishedAt: {notNull: true}}
    pagination: {pageSize: 9999}
  ) {
    name
    description
    key
    icon {
      ...StrapiImage
    }
  }
  read_more {
    button_text
    content
  }
  heading_text
  hide_breadcrumbs
  hide_nav_items
  hide_sidebar
}

fragment HeroBannerSection on ComponentPageSectionsHeroBannerSection {
  __typename
  id
  heroBannerSection_title: title
  link {
    ...StrapiPageLink
  }
  link_external
  mobile_background_image {
    ...StrapiImage
  }
  desktop_background_image {
    ...StrapiImage
  }
}

fragment SecondaryNavSection on ComponentPageSectionsSecondaryNavSection {
  __typename
  id
  nav_button_text_1
  nav_button_link_1 {
    ...StrapiPageLink
  }
  nav_button_text_2
  nav_button_link_2 {
    ...StrapiPageLink
  }
  nav_button_text_3
  nav_button_link_3 {
    ...StrapiPageLink
  }
  nav_button_text_4
  nav_button_link_4 {
    ...StrapiPageLink
  }
}

fragment HorizontalBackgroundTextImageSection on ComponentPageSectionsHorizontalBgTextImageSection {
  __typename
  id
  title
  description
  light_text_colour
  desktop_background_image {
    ...StrapiImage
  }
  mobile_background_image {
    ...StrapiImage
  }
  button_text
  button_link {
    ...StrapiPageLink
  }
  button_link_external
  centered
}

fragment HorizontalImageCtaSection on ComponentPageSectionsHorizontalImageCtaSection {
  __typename
  id
  title
  description
  image {
    ...StrapiImage
  }
  button_text
  button_link {
    ...StrapiPageLink
  }
  button_link_external
  reverse
  image_first_on_mobile
  button_2_text
  button_2_link {
    ...StrapiPageLink
  }
  button_2_link_external
}

fragment ImageBannerSection on ComponentPageSectionsImageBannerSection {
  __typename
  id
  desktop_image {
    ...StrapiImage
  }
  mobile_image {
    ...StrapiImage
  }
}

fragment PatternedHeroSection on ComponentPageSectionsPatternedHeroSection {
  __typename
  id
  patternedHero_title: title
  content
}

fragment UserLocationSection on ComponentPageSectionsUserLocationSection {
  __typename
  id
  label
  userLocation_button_text: button_text
  redirect {
    ...StrapiPageLink
  }
}

fragment OurTeamSection on ComponentPageSectionsOurTeamSection {
  __typename
  id
  title
  team_members {
    name
    role
    description
    image {
      ...StrapiImage
    }
  }
}

fragment HeadingImageSection on ComponentPageSectionsHeadingImageSection {
  __typename
  id
  heading_image_title: title
  heading_desktop_image: desktop_image {
    ...StrapiImage
  }
  heading_mobile_image: mobile_image {
    ...StrapiImage
  }
}

fragment VideoHeroSection on ComponentPageSectionsVideoHeroSection {
  __typename
  id
  videoHeroSection_title: title
  video {
    url
    alternativeText
    mime
    width
    height
  }
  mobile_video {
    url
    alternativeText
    mime
    width
    height
  }
  button_text
  button_link {
    ...StrapiPageLink
  }
  button_link_external
}

fragment ContentDividerSection on ComponentPageSectionsContentDividerSection {
  __typename
  id
}

fragment OurOpportunitiesSection on ComponentPageSectionsOurOpportunitiesSection {
  __typename
  id
  our_opportunities_title: title
  our_opportunities_description: description
  job_listings {
    title
    description
    location
    contract_type
    salary
    salary_affix
    image {
      ...StrapiImage
    }
    apply_now_link
  }
  all_jobs_link
  all_jobs_text
}

fragment RestaurantsMapSection on ComponentPageSectionsRestaurantsMapSection {
  __typename
  id
}

fragment BasicBackgroundHeroSection on ComponentPageSectionsBasicBackgroundHeroSection {
  __typename
  id
  basicBackgroundHero_title: title
  basicBackgroundHero_background_image: background_image {
    ...StrapiImage
  }
}

fragment RestaurantDetailsSection on ComponentPageSectionsRestaurantDetailsSection {
  __typename
  id
  restaurantDetails_title: title
  intro_text
  restaurant {
    documentId
    location_lat
    location_lng
    address
    telephone_number
    opening_hours_notice
    monday_open
    monday_close
    tuesday_open
    tuesday_close
    wednesday_open
    wednesday_close
    thursday_open
    thursday_close
    friday_open
    friday_close
    saturday_open
    saturday_close
    sunday_open
    sunday_close
    facilities {
      documentId
      name
      icon {
        ...StrapiImage
      }
    }
    deliveroo_url
    uber_eats_url
    just_eat_url
    view_menu_details {
      btn_text
      external_link
      page {
        ...StrapiPageLink
      }
    }
    sale_text
  }
  menu_link {
    ...StrapiPageLink
  }
}

fragment TextCarouselSection on ComponentPageSectionsTextCarouselSection {
  __typename
  id
  slides {
    name
    content
    url
  }
}

fragment RetailerLogosGridSection on ComponentPageSectionsRetailerLogosGridSection {
  __typename
  id
  retailers {
    documentId
    name
    logo {
      ...StrapiImage
    }
    link
  }
}

fragment TextHeroSection on ComponentPageSectionsTextHeroSection {
  __typename
  id
  textHero_title: title
  textHero_text: text
}

fragment StoresMapSection on ComponentPageSectionsStoresMapSection {
  __typename
  id
}

fragment BonusRecipeCarouselSection on ComponentPageSectionsBonusRecipeCarouselSection {
  __typename
  id
  bonusRecipe_title: title
  bonusRecipe_button_text: button_text
  bonusRecipe_button_link: button_link {
    ...StrapiPageLink
  }
  bonusRecipe_show_navigation_buttons: show_navigation_buttons
  recipes(
    filters: {publishedAt: {notNull: true}, page: {documentId: {notNull: true}}}
  ) {
    documentId
    publishedAt
    name
    mobile_image {
      ...StrapiImage
    }
    desktop_image {
      ...StrapiImage
    }
    page {
      ...StrapiPageLink
    }
  }
}

fragment FaqsSection on ComponentPageSectionsFaqSection {
  __typename
  id
  faqSectionTitle: title
  intro
  faqs(pagination: {pageSize: 9999}) {
    title
    content
    centered
  }
}

fragment SitemapSection on ComponentPageSectionsSitemapSection {
  __typename
  id
}

fragment ContactFormSection on ComponentPageSectionsContactFormSection {
  __typename
  id
  op_code
  contactForm_title: title
  text
  contact_address
  submit_button_text
  success_title
  success_text
}

fragment RestaurantsCarouselSection on ComponentPageSectionsRestaurantsCarouselSection {
  __typename
  id
  restaurantCarouselSection_title: title
  restaurants(
    filters: {page: {documentId: {not: null}}}
    pagination: {pageSize: 9999}
  ) {
    name
    image {
      ...StrapiImage
    }
    address
    page {
      ...StrapiPageLink
    }
  }
  restaurantsCarouselSection_show_navigation_buttons: show_navigation_buttons
}

fragment BasicTextSection on ComponentPageSectionsBasicTextSection {
  __typename
  id
  basicText_content: content
  basicText_centered: centered
  container_width
}

fragment CollapsibleContentSection on ComponentPageSectionsCollapsibleContentSection {
  __typename
  id
  collapsibleContent_title: title
  intro
  collapse_title
  collapse_content
  centered
}

fragment JobCategoriesSection on ComponentPageSectionsJobCategoriesSection {
  __typename
  id
  jobCategories_title: title
  jobCategories_description: description
  all_jobs_link
  all_jobs_text
  job_categories {
    title
    description
    apply_now_button_text
    apply_now_button_link
    image {
      ...StrapiImage
    }
  }
}

fragment RecipeListingsSection on ComponentPageSectionsRecipeListingsSection {
  __typename
  id
}

fragment AllItsuLocationsSection on ComponentPageSectionsAllItsuLocationsSection {
  __typename
  id
  allItsuLocations_title: title
}

fragment AreaRestaurantsListSection on ComponentPageSectionsAreaRestaurantsListSection {
  __typename
  id
  location_area {
    name
    restaurants(
      pagination: {pageSize: 9999}
      filters: {page: {documentId: {notNull: true}}}
    ) {
      name
      address
      page {
        ...StrapiPageLink
      }
    }
  }
}

fragment NewsletterPreferencesSection on ComponentPageSectionsNewsletterPreferencesSection {
  __typename
  id
  newsletterPreferences_title: title
  text
  submit_button_text
  success_title
  success_text
  interests {
    name
    key
    icon {
      ...StrapiImage
    }
  }
}

fragment ProductRetailersMapSection on ComponentPageSectionsProductRetailersMapSection {
  __typename
  id
  grocery_products(
    pagination: {pageSize: 9999}
    filters: {page: {documentId: {notNull: true}}}
  ) {
    page {
      components {
        ... on ComponentPageTemplatesGroceryPageTemplate {
          retailers(pagination: {pageSize: 9999}) {
            id
            retailer {
              name
              stores(pagination: {pageSize: 9999}) {
                documentId
                location_lat
                location_lng
                address
              }
            }
          }
        }
      }
    }
  }
}

fragment CardColumnsSection on ComponentPageSectionsCardColumnsSection {
  __typename
  id
  columns(pagination: {pageSize: 9999}) {
    id
    image {
      ...StrapiImage
    }
    text
  }
}

fragment LandingPageFormSection on ComponentPageSectionsLandingPageFormSection {
  __typename
  id
  landingPageForm_title: title
  landingPageForm_text: text
  submit_button_text
  success_title
  success_text
  source
  utm_source
  utm_medium
  utm_campaign
  home_site
}

fragment MapSection on ComponentPageSectionsMapSection {
  __typename
  id
  markers(pagination: {pageSize: 9999}) {
    id
    title
    address
    postcode
    text
    lat
    lng
  }
}

fragment RegionChoiceSection on ComponentPageSectionsRegionChoiceSection {
  __typename
  id
  regionChoice_title: title
  regionChoice_intro: intro
  region(pagination: {pageSize: 9999}) {
    name
    icon {
      ...StrapiImage
    }
    locale {
      code
    }
    page {
      uri
    }
  }
}

fragment RegionRetailersSection on ComponentPageSectionsRegionRetailersSection {
  __typename
  id
  regionRetailers_title: title
  regionRetailers_intro: intro
  regionRetailers_retailers: retailers(pagination: {pageSize: 9999}) {
    name
    icon {
      ...StrapiImage
    }
    link
  }
}

fragment RegionFeaturedProductsSection on ComponentPageSectionsRegionFeaturedProductsSection {
  __typename
  id
  regionFeaturedProducts_title: title
  regionFeaturedProducts_regionalProducts: regional_products(
    pagination: {pageSize: 9999}
  ) {
    title
    calories
    product_image {
      ...StrapiImage
    }
  }
  regionFeaturedProducts_products: products(pagination: {pageSize: 9999}) {
    marketing_title
    calories
    website_product_image {
      ...StrapiImage
    }
    website_thumbnail_image {
      ...StrapiImage
    }
    page {
      ...StrapiPageLink
    }
  }
}

fragment MultipleImageCtaSection on ComponentPageSectionsMultipleImageCtaSection {
  __typename
  id
  image_text_link(pagination: {limit: -1}) {
    text
    image {
      ...StrapiImage
    }
    link {
      ...StrapiPageLink
    }
    link_external
  }
}

fragment BreadcrumbsSection on ComponentPageSectionsBreadcrumbsSection {
  __typename
  id
}

fragment LinkCardsSection on ComponentPageSectionsLinkCardsSection {
  __typename
  id
  linkCards_title: title
  links {
    title
    text
    image {
      ...StrapiImage
    }
    external_link
    page {
      ...StrapiPageLink
    }
    button_text
  }
  linkCardsSection_show_navigation_buttons: show_navigation_buttons
}

fragment RestaurantReviewsWidgetSection on ComponentPageSectionsRestaurantReviewsWidgetSection {
  __typename
  id
  restaurantReviewsWidgetSection_title: title
  token
  widget_id
}

fragment PageTemplates on PageComponentsDynamicZone {
  ... on ComponentPageTemplatesRestaurantLocationTemplate {
    ...RestaurantLocationTemplate
  }
  ... on ComponentPageTemplatesRecipePageTemplate {
    ...RecipePageTemplate
  }
  ... on ComponentPageTemplatesMenuListingsTemplate {
    ...MenuListingsTemplate
  }
  ... on ComponentPageTemplatesGroceryListingsTemplate {
    ...GroceryListingsTemplate
  }
  ... on ComponentPageTemplatesBlogListingsTemplate {
    ...BlogListingsTemplate
  }
  ... on ComponentPageTemplatesBlogPostTemplate {
    ...BlogPostTemplate
  }
  ... on ComponentPageTemplatesAreaRestaurantsTemplate {
    ...AreaRestaurantsTemplate
  }
  ... on ComponentPageTemplatesGroceryPageTemplate {
    ...GroceryPageTemplate
  }
  ... on ComponentPageTemplatesProductPageTemplate {
    ...ProductPageTemplate
  }
}

fragment RestaurantLocationTemplate on ComponentPageTemplatesRestaurantLocationTemplate {
  __typename
  id
  hero {
    ...BasicBackgroundHeroSection
  }
  restaurant_details {
    ...RestaurantDetailsSection
  }
}

fragment RecipePageTemplate on ComponentPageTemplatesRecipePageTemplate {
  __typename
  id
  recipe_content_section {
    ...RecipeContentSection
  }
  bonus_recipe_carousel {
    ...BonusRecipeCarouselSection
  }
}

fragment RecipeContentSection on ComponentPageSectionsRecipeContentSection {
  __typename
  id
  back_button_link {
    ...StrapiPageLink
  }
  section_name
  recipe {
    ...RecipeContent
  }
  read_more {
    button_text
    content
  }
}

fragment RecipeContent on Recipe {
  name
  description
  recipe_tag
  serves
  cook_time
  prep_time
  where_to_buy_link {
    ...StrapiPageLink
  }
  make_me_veggie_url {
    ...StrapiPageLink
  }
  mobile_image {
    ...StrapiImage
  }
  desktop_image {
    ...StrapiImage
  }
  instructions_title
  instruction_sub_title_text
  instruction_sub_title_link
  steps(pagination: {pageSize: 9999}) {
    step
  }
  ingredients(pagination: {pageSize: 9999}) {
    name
    get_me_link
  }
  grocery_products(filters: {publishedAt: {notNull: true}}) {
    name
    calories
    website_product_image {
      ...StrapiImage
    }
    website_thumbnail_image {
      ...StrapiImage
    }
    page {
      ...StrapiPageLink
    }
  }
  page {
    ...StrapiPageLink
  }
}

fragment MenuListingsTemplate on ComponentPageTemplatesMenuListingsTemplate {
  __typename
  id
  menuListingsTemplate_menu_listings_section: menu_listings_section {
    ...MenuListingsSection
  }
}

fragment MenuListingsSection on ComponentPageSectionsMenuListingsSection {
  __typename
  id
  product_category {
    documentId
    name
    page {
      ...StrapiPageLink
    }
  }
  menu_link {
    ...StrapiPageLink
  }
  dietary_labels(
    filters: {publishedAt: {notNull: true}}
    pagination: {pageSize: 9999}
  ) {
    name
    description
    key
    icon {
      ...StrapiImage
    }
  }
  sort_labels(
    filters: {publishedAt: {notNull: true}}
    pagination: {pageSize: 9999}
  ) {
    name
    description
    key
    icon {
      ...StrapiImage
    }
  }
  read_more {
    button_text
    content
  }
}

fragment GroceryListingsTemplate on ComponentPageTemplatesGroceryListingsTemplate {
  __typename
  id
  menuListingsTemplate_menu_listings_section: grocery_listings_section {
    ...GroceryListingsSection
  }
}

fragment BlogListingsTemplate on ComponentPageTemplatesBlogListingsTemplate {
  __typename
  id
  blogListingsTemplate_hero: hero {
    ...TextHeroSection
  }
  blogListingsTemplate_blog_listings: blog_listings {
    ...BlogListingsSection
  }
}

fragment BlogListingsSection on ComponentPageSectionsBlogListingsSection {
  __typename
  id
}

fragment BlogPostTemplate on ComponentPageTemplatesBlogPostTemplate {
  __typename
  id
  blogPageTemplate_hero: hero {
    ...BasicBackgroundHeroSection
  }
  blog_post_content {
    ...BlogPostSection
  }
  recent_blog_posts {
    ...RecentBlogPostsSection
  }
}

fragment BlogPostSection on ComponentPageSectionsBlogPostSection {
  __typename
  id
  content
}

fragment RecentBlogPostsSection on ComponentPageSectionsRecentBlogPostsSection {
  __typename
  id
}

fragment AreaRestaurantsTemplate on ComponentPageTemplatesAreaRestaurantsTemplate {
  __typename
  id
  basic_background_hero {
    ...BasicBackgroundHeroSection
  }
  area_restaurants_list {
    ...AreaRestaurantsListSection
  }
}

fragment GroceryPageTemplate on ComponentPageTemplatesGroceryPageTemplate {
  __typename
  id
  how_to_enjoy
  ingredients
  ingredients_disclaimer
  groceryPageTemplate_story_title: story_title
  groceryPageTemplate_story_content: story_content
  nutrition_text
  read_more {
    button_text
    content
  }
  product_retailers: retailers {
    id
    link
    retailer {
      name
      logo {
        ...StrapiImage
      }
    }
  }
  grocery_product {
    marketing_title
    marketing_product_description
    calories_text
    calories
    weight
    fat
    fat_saturated
    protein
    carbs
    sugars
    fibre
    salt
    energy
    plant_points
    plant_points_description
    plant_points_image {
      ...StrapiImage
    }
    plant_points_background
    website_product_image {
      ...StrapiImage
    }
    allergens(pagination: {pageSize: 9999}) {
      name
    }
    may_contain(pagination: {pageSize: 9999}) {
      name
    }
    dietary_labels(pagination: {pageSize: 9999}) {
      name
      description
      icon {
        ...StrapiImage
      }
    }
    category {
      name
      page {
        ...StrapiPageLink
      }
    }
    related_recipes(
      filters: {publishedAt: {notNull: true}, page: {documentId: {notNull: true}}}
    ) {
      name
      description
      recipe_tag
      desktop_image {
        ...StrapiImage
      }
      page {
        ...StrapiPageLink
      }
    }
  }
}

fragment ProductPageTemplate on ComponentPageTemplatesProductPageTemplate {
  __typename
  id
  productPageTemplate_story_title: story_title
  productPageTemplate_story_content: story_content
  product {
    marketing_title
    marketing_product_description
    ingredients
    calories
    fat
    fat_saturated
    protein
    carbs
    sugars
    fibre
    salt
    plant_points
    plant_points_description
    plant_points_image {
      ...StrapiImage
    }
    plant_points_background
    website_product_image {
      ...StrapiImage
    }
    allergens(pagination: {pageSize: 9999}) {
      name
    }
    may_contain(pagination: {pageSize: 9999}) {
      name
    }
    category {
      name
      page {
        ...StrapiPageLink
      }
    }
  }
  read_more {
    button_text
    content
  }
  pdf_button_text
  pdf_button_file {
    url
  }
  show_soy_sauce_modal_button
}

fragment PageSeo on ComponentSharedSeo {
  metaTitle
  metaDescription
  metaRobots
  keywords
  metaImage {
    ...StrapiImage
  }
  metaSocial {
    description
    title
    socialNetwork
    image {
      ...StrapiImage
    }
  }
  structuredData
  canonicalURL
}

fragment Redirect on Query {
  redirects(
    filters: {from: {eq: $path}, site: {domain: {eq: $site}}}
    pagination: {pageSize: 1}
  ) {
    to
    type
  }
}`
