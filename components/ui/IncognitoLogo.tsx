/**
 * Inline-SVG version of the Incognito Browser logo.
 *
 * Inlined (vs <Image src="/icon.svg">) so it works on every deploy target
 * regardless of basePath. The next/image component had to resolve the src
 * differently for WordPress (/resources/) vs Cloudflare (root), and a wrong
 * path silently failed — rendering the alt text where the icon should be,
 * which collided with surrounding text.
 *
 * Size defaults to 28px to match prior usage. Pass `size` to override.
 */
export function IncognitoLogo({
  size = 28,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 40 40"
      width={size}
      height={size}
      aria-hidden="true"
      fill="none"
      className={`shrink-0 ${className}`}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8.25432 17.5805L7.43397 13.8714C7.43397 13.8714 0.363648 14.9423 0.0141218 17.7194C-0.335404 20.4964 5.91936 23.4874 5.91936 23.4874C5.91936 23.4874 11.3091 25.8319 19.661 25.9612C28.0129 26.0905 33.1249 23.6262 33.1249 23.6262C33.1249 23.6262 39.7245 21.1157 39.8617 17.9875C39.999 14.8593 32.5775 13.9991 32.5775 13.9991L31.7572 17.2933C31.7572 17.2933 29.9297 10.2421 28.3241 6.70852C27.7512 5.45246 25.9892 5.05665 25.9892 5.05665C25.0637 4.92657 24.1204 5.02128 23.2393 5.33276C22.0024 5.78602 20.8756 6.8745 20.2068 6.84737C18.8518 6.81705 17.1138 5.02154 14.5761 5.06144C12.9051 5.07101 11.6873 6.85216 11.6873 6.85216C10.9486 8.41273 10.3089 10.0183 9.77213 11.6593C9.16532 13.6058 8.65872 15.5822 8.25432 17.5805Z"
        fill="white"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M7.83934 29.8092L7.56323 27.4742C7.56323 27.4742 10.3499 26.8007 13.2003 26.9204C16.5057 27.0672 19.1167 28.0184 19.9387 28.0184C20.7606 28.0184 23.8234 27.0608 27.2197 27.0608C28.981 27.0853 30.7335 27.3146 32.4418 27.7439L32.0269 29.7996H31.3438C31.3438 29.7996 31.5034 32.5862 30.2457 34.2014C29.2035 35.5213 26.6754 35.7144 26.6754 35.7144C26.6754 35.7144 24.3772 35.7798 22.6854 34.4791C21.0798 33.2422 20.8293 30.6295 20.0728 30.6295C19.3162 30.6295 18.8454 33.223 17.0403 34.6195C15.5816 35.7463 13.4685 35.7176 13.4685 35.7176C13.4685 35.7176 10.8478 35.558 9.75775 34.2046C8.52243 32.682 8.80014 29.8028 8.80014 29.8028H7.83934V29.8092Z"
        fill="white"
      />
    </svg>
  );
}
