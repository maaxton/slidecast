/**
 * Element Renderer - Renders slide elements to HTML
 *
 * This is the SINGLE SOURCE OF TRUTH for how elements are rendered to HTML.
 * Used by both frontend (Svelte) and backend (Playwright PNG rendering).
 */

import {
  styleToString,
  getElementStyle,
  getTextStyle,
  getShapeStyle,
  getImageStyle,
  getVideoStyle,
  getQRStyle,
  getNavContainerStyle,
  getNavStyle,
  getNavItemStyle,
  getPingStyle,
} from './styleBuilder.js';

import { escapeHtml, renderPrimitivesToHtml, isNativeWidget } from './widgetRenderer.js';

/**
 * Font Awesome icon class to SVG path mapping
 * Used for server-side rendering with Playwright
 */
const FA_ICON_SVGS = {
  // Solid icons (fa-solid)
  'fa-home': 'M575.8 255.5c0 18-15 32.1-32 32.1h-32l.7 160.2c0 2.7-.2 5.4-.5 8.1V472c0 22.1-17.9 40-40 40H456c-1.1 0-2.2 0-3.3-.1c-1.4 .1-2.8 .1-4.2 .1H416 392c-22.1 0-40-17.9-40-40V376c0-22.1-17.9-40-40-40H296c-22.1 0-40 17.9-40 40v96c0 22.1-17.9 40-40 40H184 152.6c-1.4 0-2.8 0-4.2-.1c-1.1 .1-2.2 .1-3.3 .1H104c-22.1 0-40-17.9-40-40V360c0-.9 0-1.9 .1-2.8V287.6H32c-18 0-32-14-32-32.1c0-9 3-17 10-24L266.4 8c7-7 15-8 22-8s15 2 21 7L564.8 231.5c8 7 12 15 11 24z',
  'fa-house': 'M575.8 255.5c0 18-15 32.1-32 32.1h-32l.7 160.2c0 2.7-.2 5.4-.5 8.1V472c0 22.1-17.9 40-40 40H456c-1.1 0-2.2 0-3.3-.1c-1.4 .1-2.8 .1-4.2 .1H416 392c-22.1 0-40-17.9-40-40V376c0-22.1-17.9-40-40-40H296c-22.1 0-40 17.9-40 40v96c0 22.1-17.9 40-40 40H184 152.6c-1.4 0-2.8 0-4.2-.1c-1.1 .1-2.2 .1-3.3 .1H104c-22.1 0-40-17.9-40-40V360c0-.9 0-1.9 .1-2.8V287.6H32c-18 0-32-14-32-32.1c0-9 3-17 10-24L266.4 8c7-7 15-8 22-8s15 2 21 7L564.8 231.5c8 7 12 15 11 24z',
  'fa-circle-info': 'M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM216 336h24V272H216c-13.3 0-24-10.7-24-24s10.7-24 24-24h48c13.3 0 24 10.7 24 24v88h8c13.3 0 24 10.7 24 24s-10.7 24-24 24H216c-13.3 0-24-10.7-24-24s10.7-24 24-24zm40-208a32 32 0 1 1 0 64 32 32 0 1 1 0-64z',
  'fa-info-circle': 'M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM216 336h24V272H216c-13.3 0-24-10.7-24-24s10.7-24 24-24h48c13.3 0 24 10.7 24 24v88h8c13.3 0 24 10.7 24 24s-10.7 24-24 24H216c-13.3 0-24-10.7-24-24s10.7-24 24-24zm40-208a32 32 0 1 1 0 64 32 32 0 1 1 0-64z',
  'fa-gear': 'M495.9 166.6c3.2 8.7 .5 18.4-6.4 24.6l-43.3 39.4c1.1 8.3 1.7 16.8 1.7 25.4s-.6 17.1-1.7 25.4l43.3 39.4c6.9 6.3 9.6 16 6.4 24.6c-4.4 11.9-9.7 23.3-15.8 34.3l-4.7 8.1c-6.6 11-14 21.4-22.1 31.2c-5.9 7.2-15.7 9.6-24.5 6.8l-55.7-17.7c-13.4 10.3-28.2 18.9-44 25.4l-12.5 57.1c-2 9.1-9 16.3-18.2 17.8c-13.8 2.3-28 3.5-42.5 3.5s-28.7-1.2-42.5-3.5c-9.2-1.5-16.2-8.7-18.2-17.8l-12.5-57.1c-15.8-6.5-30.6-15.1-44-25.4L83.1 425.9c-8.8 2.8-18.6 .3-24.5-6.8c-8.1-9.8-15.5-20.2-22.1-31.2l-4.7-8.1c-6.1-11-11.4-22.4-15.8-34.3c-3.2-8.7-.5-18.4 6.4-24.6l43.3-39.4C64.6 273.1 64 264.6 64 256s.6-17.1 1.7-25.4L22.4 191.2c-6.9-6.3-9.6-16-6.4-24.6c4.4-11.9 9.7-23.3 15.8-34.3l4.7-8.1c6.6-11 14-21.4 22.1-31.2c5.9-7.2 15.7-9.6 24.5-6.8l55.7 17.7c13.4-10.3 28.2-18.9 44-25.4l12.5-57.1c2-9.1 9-16.3 18.2-17.8C227.3 1.2 241.5 0 256 0s28.7 1.2 42.5 3.5c9.2 1.5 16.2 8.7 18.2 17.8l12.5 57.1c15.8 6.5 30.6 15.1 44 25.4l55.7-17.7c8.8-2.8 18.6-.3 24.5 6.8c8.1 9.8 15.5 20.2 22.1 31.2l4.7 8.1c6.1 11 11.4 22.4 15.8 34.3zM256 336a80 80 0 1 0 0-160 80 80 0 1 0 0 160z',
  'fa-cog': 'M495.9 166.6c3.2 8.7 .5 18.4-6.4 24.6l-43.3 39.4c1.1 8.3 1.7 16.8 1.7 25.4s-.6 17.1-1.7 25.4l43.3 39.4c6.9 6.3 9.6 16 6.4 24.6c-4.4 11.9-9.7 23.3-15.8 34.3l-4.7 8.1c-6.6 11-14 21.4-22.1 31.2c-5.9 7.2-15.7 9.6-24.5 6.8l-55.7-17.7c-13.4 10.3-28.2 18.9-44 25.4l-12.5 57.1c-2 9.1-9 16.3-18.2 17.8c-13.8 2.3-28 3.5-42.5 3.5s-28.7-1.2-42.5-3.5c-9.2-1.5-16.2-8.7-18.2-17.8l-12.5-57.1c-15.8-6.5-30.6-15.1-44-25.4L83.1 425.9c-8.8 2.8-18.6 .3-24.5-6.8c-8.1-9.8-15.5-20.2-22.1-31.2l-4.7-8.1c-6.1-11-11.4-22.4-15.8-34.3c-3.2-8.7-.5-18.4 6.4-24.6l43.3-39.4C64.6 273.1 64 264.6 64 256s.6-17.1 1.7-25.4L22.4 191.2c-6.9-6.3-9.6-16-6.4-24.6c4.4-11.9 9.7-23.3 15.8-34.3l4.7-8.1c6.6-11 14-21.4 22.1-31.2c5.9-7.2 15.7-9.6 24.5-6.8l55.7 17.7c13.4-10.3 28.2-18.9 44-25.4l12.5-57.1c2-9.1 9-16.3 18.2-17.8C227.3 1.2 241.5 0 256 0s28.7 1.2 42.5 3.5c9.2 1.5 16.2 8.7 18.2 17.8l12.5 57.1c15.8 6.5 30.6 15.1 44 25.4l55.7-17.7c8.8-2.8 18.6-.3 24.5 6.8c8.1 9.8 15.5 20.2 22.1 31.2l4.7 8.1c6.1 11 11.4 22.4 15.8 34.3zM256 336a80 80 0 1 0 0-160 80 80 0 1 0 0 160z',
  'fa-bars': 'M0 96C0 78.3 14.3 64 32 64H416c17.7 0 32 14.3 32 32s-14.3 32-32 32H32C14.3 128 0 113.7 0 96zM0 256c0-17.7 14.3-32 32-32H416c17.7 0 32 14.3 32 32s-14.3 32-32 32H32c-17.7 0-32-14.3-32-32zM448 416c0 17.7-14.3 32-32 32H32c-17.7 0-32-14.3-32-32s14.3-32 32-32H416c17.7 0 32 14.3 32 32z',
  'fa-magnifying-glass': 'M416 208c0 45.9-14.9 88.3-40 122.7L502.6 457.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376c-34.4 25.2-76.8 40-122.7 40C93.1 416 0 322.9 0 208S93.1 0 208 0S416 93.1 416 208zM208 352a144 144 0 1 0 0-288 144 144 0 1 0 0 288z',
  'fa-search': 'M416 208c0 45.9-14.9 88.3-40 122.7L502.6 457.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376c-34.4 25.2-76.8 40-122.7 40C93.1 416 0 322.9 0 208S93.1 0 208 0S416 93.1 416 208zM208 352a144 144 0 1 0 0-288 144 144 0 1 0 0 288z',
  'fa-phone': 'M164.9 24.6c-7.7-18.6-28-28.5-47.4-23.2l-88 24C12.1 30.2 0 46 0 64C0 311.4 200.6 512 448 512c18 0 33.8-12.1 38.6-29.5l24-88c5.3-19.4-4.6-39.7-23.2-47.4l-96-40c-16.3-6.8-35.2-2.1-46.3 11.6L304.7 368C234.3 334.7 177.3 277.7 144 207.3L193.3 167c13.7-11.2 18.4-30 11.6-46.3l-40-96z',
  'fa-envelope': 'M48 64C21.5 64 0 85.5 0 112c0 15.1 7.1 29.3 19.2 38.4L236.8 313.6c11.4 8.5 27 8.5 38.4 0L492.8 150.4c12.1-9.1 19.2-23.3 19.2-38.4c0-26.5-21.5-48-48-48H48zM0 176V384c0 35.3 28.7 64 64 64H448c35.3 0 64-28.7 64-64V176L294.4 339.2c-22.8 17.1-54 17.1-76.8 0L0 176z',
  'fa-location-dot': 'M215.7 499.2C267 435 384 279.4 384 192C384 86 298 0 192 0S0 86 0 192c0 87.4 117 243 168.3 307.2c12.3 15.3 35.1 15.3 47.4 0zM192 128a64 64 0 1 1 0 128 64 64 0 1 1 0-128z',
  'fa-map-marker': 'M215.7 499.2C267 435 384 279.4 384 192C384 86 298 0 192 0S0 86 0 192c0 87.4 117 243 168.3 307.2c12.3 15.3 35.1 15.3 47.4 0zM192 128a64 64 0 1 1 0 128 64 64 0 1 1 0-128z',
  'fa-calendar': 'M128 0c17.7 0 32 14.3 32 32V64H288V32c0-17.7 14.3-32 32-32s32 14.3 32 32V64h48c26.5 0 48 21.5 48 48v48H0V112C0 85.5 21.5 64 48 64H96V32c0-17.7 14.3-32 32-32zM0 192H448V464c0 26.5-21.5 48-48 48H48c-26.5 0-48-21.5-48-48V192z',
  'fa-clock': 'M256 0a256 256 0 1 1 0 512A256 256 0 1 1 256 0zM232 120V256c0 8 4 15.5 10.7 20l96 64c11 7.4 25.9 4.4 33.3-6.7s4.4-25.9-6.7-33.3L280 243.2V120c0-13.3-10.7-24-24-24s-24 10.7-24 24z',
  'fa-utensils': 'M416 0C400 0 288 32 288 176V288c0 35.3 28.7 64 64 64h32V480c0 17.7 14.3 32 32 32s32-14.3 32-32V352 240 32c0-17.7-14.3-32-32-32zM64 16C64 7.8 57.9 1 49.7 .1S34.2 4.6 32.4 12.5L2.1 148.8C.7 155.1 0 161.5 0 167.9c0 45.9 35.1 83.6 80 87.7V480c0 17.7 14.3 32 32 32s32-14.3 32-32V255.6c44.9-4.1 80-41.8 80-87.7c0-6.4-.7-12.8-2.1-19.1L191.6 12.5c-1.8-8-9.3-13.3-17.4-12.4S160 7.8 160 16V150.2c0 5.4-4.4 9.8-9.8 9.8c-5.1 0-9.3-3.9-9.8-9L127.9 14.6C127.2 6.3 120.3 0 112 0s-15.2 6.3-15.9 14.6L83.7 151c-.5 5.1-4.7 9-9.8 9c-5.4 0-9.8-4.4-9.8-9.8V16z',
  'fa-wifi': 'M256 160c-52.9 0-102.1 15.9-143 43.2c-13 8.7-30.6 5.1-39.3-7.9s-5.1-30.6 7.9-39.3c52.2-34.8 114.5-55.9 182.3-55.9c59.8 0 122.1 21.2 174.4 56c13 8.7 16.5 26.3 7.9 39.3s-26.3 16.5-39.3 7.9c-40.8-27.3-90.1-43.2-143-43.2zm0 64c-30.4 0-59.1 8.8-83.6 24c-12.8 7.9-29.5 3.9-37.4-8.9s-3.9-29.5 8.9-37.4C177.4 170.7 215.7 160 256 160s78.6 10.7 112.1 27.6c12.8 7.9 16.8 24.6 8.9 37.4s-24.6 16.8-37.4 8.9C315.1 232.8 286.4 224 256 224zm0 64c-17.7 0-32 14.3-32 32s14.3 32 32 32s32-14.3 32-32s-14.3-32-32-32z',
  'fa-circle-question': 'M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM169.8 165.3c7.9-22.3 29.1-37.3 52.8-37.3h58.3c34.9 0 63.1 28.3 63.1 63.1c0 22.6-12.1 43.5-31.7 54.8L280 264.4c-.2 13-10.9 23.6-24 23.6c-13.3 0-24-10.7-24-24V250.5c0-8.6 4.6-16.5 12.1-20.8l44.3-25.4c4.7-2.7 7.6-7.7 7.6-13.1c0-8.4-6.8-15.1-15.1-15.1H222.6c-3.4 0-6.4 2.1-7.5 5.3l-.4 1.2c-4.4 12.5-18.2 19-30.6 14.6s-19-18.2-14.6-30.6l.4-1.2zM224 352a32 32 0 1 1 64 0 32 32 0 1 1 -64 0z',
  'fa-question-circle': 'M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM169.8 165.3c7.9-22.3 29.1-37.3 52.8-37.3h58.3c34.9 0 63.1 28.3 63.1 63.1c0 22.6-12.1 43.5-31.7 54.8L280 264.4c-.2 13-10.9 23.6-24 23.6c-13.3 0-24-10.7-24-24V250.5c0-8.6 4.6-16.5 12.1-20.8l44.3-25.4c4.7-2.7 7.6-7.7 7.6-13.1c0-8.4-6.8-15.1-15.1-15.1H222.6c-3.4 0-6.4 2.1-7.5 5.3l-.4 1.2c-4.4 12.5-18.2 19-30.6 14.6s-19-18.2-14.6-30.6l.4-1.2zM224 352a32 32 0 1 1 64 0 32 32 0 1 1 -64 0z',
  'fa-image': 'M0 96C0 60.7 28.7 32 64 32H384c35.3 0 64 28.7 64 64V416c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V96zM323.8 202.5c-4.5-6.6-11.9-10.5-19.8-10.5s-15.4 3.9-19.8 10.5l-87 127.6L170.7 297c-4.6-5.7-11.5-9-18.7-9s-14.2 3.3-18.7 9l-64 80c-5.8 7.2-6.9 17.1-2.9 25.4s12.4 13.6 21.6 13.6h96 32H424c8.9 0 17.1-4.9 21.2-12.8s3.6-17.4-1.4-24.7l-120-176zM112 192a48 48 0 1 0 0-96 48 48 0 1 0 0 96z',
  'fa-cart-shopping': 'M0 24C0 10.7 10.7 0 24 0H69.5c22 0 41.5 12.8 50.6 32h411c26.3 0 45.5 25 38.6 50.4l-41 152.3c-8.5 31.4-37 53.3-69.5 53.3H170.7l5.4 28.5c2.2 11.3 12.1 19.5 23.6 19.5H488c13.3 0 24 10.7 24 24s-10.7 24-24 24H199.7c-34.6 0-64.3-24.6-70.7-58.5L77.4 54.5c-.7-3.8-4-6.5-7.9-6.5H24C10.7 48 0 37.3 0 24zM128 464a48 48 0 1 1 96 0 48 48 0 1 1 -96 0zm336-48a48 48 0 1 1 0 96 48 48 0 1 1 0-96z',
  'fa-tag': 'M0 80V229.5c0 17 6.7 33.3 18.7 45.3l176 176c25 25 65.5 25 90.5 0L418.7 317.3c25-25 25-65.5 0-90.5l-176-176c-12-12-28.3-18.7-45.3-18.7H48C21.5 32 0 53.5 0 80zm112 32a32 32 0 1 1 0 64 32 32 0 1 1 0-64z',
  'fa-circle-dot': 'M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zm0-352a96 96 0 1 1 0 192 96 96 0 1 1 0-192z',
  'fa-chevron-left': 'M9.4 233.4c-12.5 12.5-12.5 32.8 0 45.3l192 192c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L77.3 256 246.6 86.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-192 192z',
  'fa-chevron-right': 'M246.6 233.4c12.5 12.5 12.5 32.8 0 45.3l-192 192c-12.5 12.5-32.8 12.5-45.3 0s-12.5-32.8 0-45.3L178.7 256 9.4 86.6C-3.1 74.1-3.1 53.9 9.4 41.4s32.8-12.5 45.3 0l192 192z',
  'fa-arrow-left': 'M9.4 233.4c-12.5 12.5-12.5 32.8 0 45.3l160 160c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L109.2 288 416 288c17.7 0 32-14.3 32-32s-14.3-32-32-32l-306.7 0L214.6 118.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-160 160z',
  'fa-arrow-right': 'M438.6 278.6c12.5-12.5 12.5-32.8 0-45.3l-160-160c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L338.8 224 32 224c-17.7 0-32 14.3-32 32s14.3 32 32 32l306.7 0L233.4 393.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0l160-160z',
  'fa-star': 'M316.9 18C311.6 7 300.4 0 288.1 0s-23.4 7-28.8 18L195 150.3 51.4 171.5c-12 1.8-22 10.2-25.7 21.7s-.7 24.2 7.9 32.7L137.8 329 113.2 474.7c-2 12 3 24.2 12.9 31.3s23 8 33.8 2.3l128.3-68.5 128.3 68.5c10.8 5.7 23.9 4.9 33.8-2.3s14.9-19.3 12.9-31.3L438.5 329 542.7 225.9c8.6-8.5 11.7-21.2 7.9-32.7s-13.7-19.9-25.7-21.7L381.2 150.3 316.9 18z',
  'fa-bell': 'M224 0c-17.7 0-32 14.3-32 32V51.2C119 66 64 130.6 64 208v18.8c0 47-17.3 92.4-48.5 127.6l-7.4 8.3c-8.4 9.4-10.4 22.9-5.3 34.4S19.4 416 32 416H416c12.6 0 24-7.4 29.2-18.9s3.1-25-5.3-34.4l-7.4-8.3C401.3 319.2 384 273.9 384 226.8V208c0-77.4-55-142-128-156.8V32c0-17.7-14.3-32-32-32zm45.3 493.3c12-12 18.7-28.3 18.7-45.3H224 160c0 17 6.7 33.3 18.7 45.3s28.3 18.7 45.3 18.7s33.3-6.7 45.3-18.7z',
  'fa-user': 'M224 256A128 128 0 1 0 224 0a128 128 0 1 0 0 256zm-45.7 48C79.8 304 0 383.8 0 482.3C0 498.7 13.3 512 29.7 512H418.3c16.4 0 29.7-13.3 29.7-29.7C448 383.8 368.2 304 269.7 304H178.3z',
  'fa-users': 'M144 0a80 80 0 1 1 0 160A80 80 0 1 1 144 0zM512 0a80 80 0 1 1 0 160A80 80 0 1 1 512 0zM0 298.7C0 239.8 47.8 192 106.7 192h42.7c15.9 0 31 3.5 44.6 9.7c-1.3 7.2-1.9 14.7-1.9 22.3c0 38.2 16.8 72.5 43.3 96H21.3C9.6 320 0 310.4 0 298.7zM405.3 320H362.7c26.5-23.5 43.3-57.8 43.3-96c0-7.6-.7-15-1.9-22.3c13.6-6.3 28.7-9.7 44.6-9.7h42.7C650.2 192 698 239.8 698 298.7c0 11.8-9.6 21.3-21.3 21.3H405.3zM224 224a96 96 0 1 1 192 0 96 96 0 1 1 -192 0zM128 485.3C128 411.7 187.7 352 261.3 352H378.7C452.3 352 512 411.7 512 485.3c0 14.7-11.9 26.7-26.7 26.7H154.7c-14.7 0-26.7-11.9-26.7-26.7z',
  'fa-play': 'M73 39c-14.8-9.1-33.4-9.4-48.5-.9S0 62.6 0 80V432c0 17.4 9.4 33.4 24.5 41.9s33.7 8.1 48.5-.9L361 297c14.3-8.8 23-24.2 23-41s-8.7-32.2-23-41L73 39z',
  'fa-pause': 'M48 64C21.5 64 0 85.5 0 112V400c0 26.5 21.5 48 48 48H80c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H48zm192 0c-26.5 0-48 21.5-48 48V400c0 26.5 21.5 48 48 48h32c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H240z',
  'fa-stop': 'M0 128C0 92.7 28.7 64 64 64H384c35.3 0 64 28.7 64 64V384c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V128z',
};

/**
 * Convert Font Awesome class to SVG HTML
 */
function getFaIconSvg(iconClass, size, color = 'currentColor') {
  if (!iconClass) return null;

  // Extract the icon name from class (e.g., "fa-solid fa-home" -> "fa-home")
  const parts = iconClass.split(' ');
  const iconName = parts.find((p) => p.startsWith('fa-') && !['fa-solid', 'fa-regular', 'fa-brands', 'fa-light', 'fa-thin', 'fa-duotone'].includes(p));

  if (!iconName) return null;

  const path = FA_ICON_SVGS[iconName];
  if (!path) return null;

  // Determine viewBox based on icon (most FA icons are 512x512, some are 448x512, 576x512, etc.)
  const viewBox = iconName.includes('chevron') || iconName.includes('arrow') ? '0 0 320 512'
    : iconName.includes('bars') || iconName.includes('utensils') ? '0 0 448 512'
      : iconName.includes('wifi') || iconName.includes('location') || iconName.includes('marker') ? '0 0 384 512'
        : iconName.includes('house') || iconName.includes('home') ? '0 0 576 512'
          : '0 0 512 512';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${size}" height="${size}" fill="${color}" style="display: inline-block; vertical-align: middle;"><path d="${path}"/></svg>`;
}

/**
 * Get default Unicode icon for common nav item labels (fallback when no icon class)
 */
function getDefaultIconForLabel(label) {
  if (!label) return '●';
  const lower = label.toLowerCase();

  const iconMap = {
    home: '🏠',
    info: 'ℹ️',
    information: 'ℹ️',
    about: 'ℹ️',
    settings: '⚙️',
    menu: '☰',
    search: '🔍',
    contact: '📞',
    phone: '📞',
    email: '✉️',
    mail: '✉️',
    location: '📍',
    calendar: '📅',
    clock: '🕐',
    time: '🕐',
    food: '🍽️',
    restaurant: '🍽️',
    wifi: '📶',
    help: '❓',
    faq: '❓',
    gallery: '🖼️',
    shop: '🛒',
    store: '🛒',
    back: '◀',
    next: '▶',
  };

  return iconMap[lower] || '●';
}

/**
 * Resolve template variables in text
 */
export function resolveVariables(text, variables = {}) {
  if (!text || typeof text !== 'string') return text || '';
  let resolved = text;
  for (const [key, value] of Object.entries(variables)) {
    resolved = resolved.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return resolved;
}

/**
 * Render a single element to HTML string
 * @param {Object} element - The element to render
 * @param {Object} options - Rendering options
 * @param {number} options.scale - Scale factor (default 1)
 * @param {Object} options.variables - Template variables
 * @param {string} options.assetBaseUrl - Base URL for assets
 * @param {string} options.currentGroupId - Current group ID (for nav active state)
 * @param {number} options.currentSlideIndex - Current slide index (for nav active state)
 * @param {number} options.focusedNavItemIndex - Explicit nav item index to highlight (-1 = auto)
 * @returns {string} HTML string
 */
export function renderElementToHtml(element, options = {}) {
  const {
    scale = 1,
    variables = {},
    assetBaseUrl = '/api/extensions/slidecast/protocol/asset',
    currentGroupId = null,
    currentSlideIndex = 0,
    focusedNavItemIndex = -1, // Explicit nav item index for highlighting
    qrDataUrl = null, // Pre-generated QR data URL for server-side rendering
    widgetPrimitives = null, // Pre-executed widget primitives for server rendering
    widgetDesignWidth = null,
    widgetDesignHeight = null,
  } = options;

  // Inject widget primitives if provided (from SlideImageRenderer widget execution)
  if (widgetPrimitives && element.type === 'widget') {
    element = { ...element, _widgetPrimitives: widgetPrimitives };
    delete element._widgetImageUrl;
  }

  switch (element.type) {
    case 'text':
      return renderTextElement(element, scale, variables);
    case 'shape':
      return renderShapeElement(element, scale);
    case 'image':
      return renderImageElement(element, scale, assetBaseUrl);
    case 'video':
      return renderVideoElement(element, scale, assetBaseUrl);
    case 'qr':
    case 'qrcode':
      return renderQRElement(element, scale, assetBaseUrl, qrDataUrl);
    case 'nav':
      return renderNavElement(element, scale, currentGroupId, currentSlideIndex, focusedNavItemIndex);
    case 'ping':
      return renderPingElement(element, scale);
    case 'widget':
      return renderWidgetElement(element, scale);
    case 'background':
      return renderBackgroundElement(element, scale);
    default:
      return '<div style="width: 100%; height: 100%;"></div>';
  }
}

/**
 * Render text element
 */
function renderTextElement(element, scale, variables) {
  const style = getTextStyle(element, scale);
  const content = escapeHtml(resolveVariables(element.content || '', variables));
  return `<div class="element-text" style="${styleToString(style)}">${content}</div>`;
}

/**
 * Render shape element
 */
function renderShapeElement(element, scale) {
  const style = getShapeStyle(element, scale);
  return `<div class="element-shape" style="${styleToString(style)}"></div>`;
}

/**
 * Render image element
 */
function renderImageElement(element, scale, assetBaseUrl) {
  const style = getImageStyle(element, scale);
  const src = element.asset_id
    ? `${assetBaseUrl}/${element.asset_id}`
    : (element.src || '');
  return `<img class="element-image" src="${escapeHtml(src)}" alt="" style="${styleToString(style)}" draggable="false" />`;
}

/**
 * Render video element
 */
function renderVideoElement(element, scale, assetBaseUrl) {
  const style = getVideoStyle(element, scale);
  const src = element.asset_id
    ? `${assetBaseUrl}/${element.asset_id}`
    : (element.src || '');

  const autoplay = element.config?.autoplay !== false && element.playback?.autoplay !== false;
  const loop = element.config?.loop !== false && element.playback?.loop !== false;
  const muted = element.config?.muted !== false && element.playback?.muted !== false;

  const attrs = [];
  if (autoplay) attrs.push('autoplay');
  if (loop) attrs.push('loop');
  if (muted) attrs.push('muted');
  attrs.push('playsinline');

  return `<video class="element-video" src="${escapeHtml(src)}" style="${styleToString(style)}" ${attrs.join(' ')}></video>`;
}

/**
 * Render QR code element
 * @param {Object} element - QR element
 * @param {number} scale - Scale factor
 * @param {string} assetBaseUrl - Base URL for assets
 * @param {string} qrDataUrl - Pre-generated data URL (for server-side rendering)
 */
function renderQRElement(element, scale, assetBaseUrl, qrDataUrl = null) {
  const containerStyle = getQRStyle(element, scale);
  const qrUrl = element.data || element.config?.url || element.config?.data || 'https://example.com';
  const size = Math.min(element.size?.width || 200, element.size?.height || 200);
  const fgColor = (element.style?.foreground || '#000000').replace('#', '');
  const bgColor = (element.style?.background || element.style?.backgroundColor || '#ffffff').replace('#', '');

  // Use pre-generated data URL if available (for Playwright rendering)
  // Otherwise use API URL (for browser rendering)
  const qrSrc = qrDataUrl || `/api/extensions/slidecast/protocol/qrcode?data=${encodeURIComponent(qrUrl)}&size=${size}&fgColor=${fgColor}&bgColor=${bgColor}`;

  return `<div class="element-qrcode" style="${styleToString(containerStyle)}">
    <img src="${escapeHtml(qrSrc)}" alt="QR Code" class="qr-image" style="max-width: 100%; max-height: 100%; object-fit: contain;" />
  </div>`;
}

/**
 * Render navigation element
 * @param {Object} element - Nav element
 * @param {number} scale - Scale factor
 * @param {string} currentGroupId - Current group ID for highlighting
 * @param {number} currentSlideIndex - Current slide index for highlighting
 * @param {number} focusedNavItemIndex - Explicit index of item to highlight (for launch_app, remote_command etc.)
 */
function renderNavElement(element, scale, currentGroupId, currentSlideIndex, focusedNavItemIndex = -1) {
  const containerStyle = getNavContainerStyle(element, scale);
  const innerStyle = getNavStyle(element, scale);

  let itemsHtml = '';
  const items = element.items || [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    // If focusedNavItemIndex is specified, use it directly for highlighting
    // This enables launch_app, remote_command, etc. to be highlighted
    const isActive = focusedNavItemIndex >= 0
      ? (i === focusedNavItemIndex)
      : isNavItemActive(item, currentGroupId, currentSlideIndex);
    const itemStyle = getNavItemStyle(element, item, isActive, scale);
    const iconPos = element.style?.iconPosition || 'left';
    const iconSize = (element.style?.iconSize || 18) * scale;

    let iconHtml = '';
    // Try Font Awesome SVG first, then fallback to unicode/emoji
    if (item.iconClass) {
      const svgIcon = getFaIconSvg(item.iconClass, iconSize, isActive ? (element.style?.activeTextColor || '#ffffff') : (element.style?.itemColor || '#ffffff'));
      if (svgIcon) {
        iconHtml = `<span class="nav-icon" style="display: inline-flex; align-items: center;">${svgIcon}</span>`;
      }
    }
    // Fallback to unicode icon if no SVG
    if (!iconHtml) {
      const unicodeIcon = item.icon || getDefaultIconForLabel(item.label);
      if (unicodeIcon) {
        iconHtml = `<span class="nav-icon" style="font-size: ${iconSize}px">${escapeHtml(unicodeIcon)}</span>`;
      }
    }

    const labelHtml = iconPos !== 'only' ? `<span class="nav-label">${escapeHtml(item.label || '')}</span>` : '';

    itemsHtml += `<button class="nav-item${isActive ? ' active' : ''}" style="${styleToString(itemStyle)}">
      ${iconHtml}${labelHtml}
    </button>`;
  }

  return `<div class="element-nav-container" style="${styleToString(containerStyle)}">
    <div class="element-nav" style="${styleToString(innerStyle)}">${itemsHtml}</div>
  </div>`;
}

/**
 * Check if nav item is active
 */
function isNavItemActive(item, currentGroupId, currentSlideIndex) {
  if (!item?.action) return false;
  const { action } = item;

  if (action.type === 'group') {
    return action.group_id === currentGroupId;
  } if (action.type === 'slide') {
    if (!action.group_id) return false;
    return action.group_id === currentGroupId && action.slide_index === currentSlideIndex;
  }
  return false;
}

/**
 * Render ping button element
 */
function renderPingElement(element, scale) {
  const style = getPingStyle(element, scale);
  const iconHtml = element.icon ? `<span class="ping-icon">${escapeHtml(element.icon)}</span>` : '';
  const labelHtml = `<span class="ping-label">${escapeHtml(element.label || '')}</span>`;

  return `<button class="element-ping" style="${styleToString(style)}">${iconHtml}${labelHtml}</button>`;
}

/**
 * Render widget element
 */
function renderWidgetElement(element, scale) {
  // If widget has primitives, render them natively (same as editor)
  if (element._widgetPrimitives) {
    const html = renderPrimitivesToHtml(element._widgetPrimitives, scale);
    return `<div class="element-widget widget-native" style="width: 100%; height: 100%;">${html}</div>`;
  }

  // If widget has image URL (server-rendered)
  if (element._widgetImageUrl) {
    return `<div class="element-widget"><img src="${escapeHtml(element._widgetImageUrl)}" alt="${escapeHtml(element._widgetName || 'Widget')}" style="width: 100%; height: 100%; object-fit: contain;" /></div>`;
  }

  // Fallback: try to render based on widget type
  const widgetUuid = element.widgetUuid || element.widget_name || '';
  const config = element.widgetConfig || element.config || {};
  const styles = element.widgetStyles || element.styles || {};

  // Clock widget
  if (widgetUuid.includes('clock')) {
    return renderClockWidget(element, scale, config, styles);
  }

  // Date widget
  if (widgetUuid.includes('date')) {
    return renderDateWidget(element, scale, config, styles);
  }

  // Placeholder for unknown widgets
  return `<div class="element-widget widget-placeholder" style="width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(255,255,255,0.05); border: 1px dashed rgba(255,255,255,0.2); border-radius: 8px;">
    <span style="font-size: 24px; opacity: 0.5;">📦</span>
    <span style="font-size: 12px; color: rgba(255,255,255,0.5);">${escapeHtml(element.widgetName || 'Widget')}</span>
  </div>`;
}

/**
 * Render clock widget fallback
 */
function renderClockWidget(element, scale, config, styles) {
  const now = new Date();
  const use24Hour = config.use24Hour || false;
  const showSeconds = config.showSeconds || false;

  const options = {
    hour: '2-digit',
    minute: '2-digit',
    hour12: !use24Hour,
  };
  if (showSeconds) options.second = '2-digit';

  const timeStr = now.toLocaleTimeString('en-US', options);

  const fontSize = (styles.fontSize || 48) * scale;
  const fontFamily = styles.fontFamily || 'Inter';
  const fontWeight = styles.fontWeight || 'bold';
  const color = styles.textColor || styles.color || '#ffffff';

  return `<div class="element-widget" style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">
    <span style="font-size: ${fontSize}px; font-family: '${fontFamily}', sans-serif; font-weight: ${fontWeight}; color: ${color};">${escapeHtml(timeStr)}</span>
  </div>`;
}

/**
 * Render date widget fallback
 */
function renderDateWidget(element, scale, config, styles) {
  const now = new Date();
  const format = config.format || 'long';

  let options;
  switch (format) {
    case 'short':
      options = { month: 'numeric', day: 'numeric', year: 'numeric' };
      break;
    case 'medium':
      options = { month: 'short', day: 'numeric', year: 'numeric' };
      break;
    case 'long':
    default:
      options = { weekday: 'long', month: 'long', day: 'numeric' };
      break;
  }

  const dateStr = now.toLocaleDateString('en-US', options);

  const fontSize = (styles.fontSize || 24) * scale;
  const fontFamily = styles.fontFamily || 'Inter';
  const fontWeight = styles.fontWeight || 'normal';
  const color = styles.textColor || styles.color || '#ffffff';

  return `<div class="element-widget" style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">
    <span style="font-size: ${fontSize}px; font-family: '${fontFamily}', sans-serif; font-weight: ${fontWeight}; color: ${color};">${escapeHtml(dateStr)}</span>
  </div>`;
}

/**
 * Render background element
 */
function renderBackgroundElement(element, scale) {
  const s = element.style || {};
  return `<div class="element-background" style="width: 100%; height: 100%; background-color: ${s.backgroundColor || '#1a1a2e'};"></div>`;
}
