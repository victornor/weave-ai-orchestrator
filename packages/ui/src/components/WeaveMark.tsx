/**
 * The Weave brand mark (VS-291): the thread running in from the left, through the three loops, and
 * out the right. The paths are copied verbatim from the ticket's `mark-svg` document — do not
 * re-trace, reshape or "clean up" the coordinates; a manual edit shows as a kink in a curve.
 *
 * The viewBox is 4.5:1, so the mark is sized by giving it a height and letting the width follow
 * (`className="h-5 w-auto"`). It accepts no width, and callers must never apply `w-full`: a width
 * chosen independently of the height distorts the knot.
 *
 * `title` is the accessible name. Omit it where an adjacent wordmark already names the product, so
 * a screen reader is not given the word twice; pass it where the mark stands alone.
 */
export interface WeaveMarkProps {
  className?: string;
  title?: string;
}

export function WeaveMark({ className, title }: WeaveMarkProps): React.ReactElement {
  return (
    <svg
      viewBox="0 0 1860.444515 413.681337"
      fill="none"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {/* Machine-traced from the mark captain supplied (weave-mark.png, 1865x422, white on a
          transparent ground). Regenerate rather than hand-editing; the recipe is:
            magick weave-mark.png -alpha extract -threshold 50% -morphology open disk:1.5
              -negate mark.pbm
            potrace -s (tight, opttolerance 0.35) -o mark.svg mark.pbm
          The thread runs in from the left edge, through the three loops, and out the right edge.
          That thread is the subject of the mark: never crop to the knot alone. */}
      <g transform="translate(-1.248645,418.864290) scale(0.100000,-0.100000)" fill="currentColor" stroke="none">
        <path d="M12863 4174 c-439 -53 -889 -263 -1208 -564 -119 -112 -295 -293
-295 -304 0 -4 53 -66 118 -137 64 -71 138 -155 165 -187 26 -31 51 -58 56
-60 5 -1 87 76 182 171 288 289 509 423 824 500 546 135 1085 -7 1455 -382
260 -263 389 -567 420 -989 53 -730 -286 -1277 -840 -1352 -500 -69 -958 234
-1600 1059 -91 117 -140 183 -384 524 -361 502 -693 876 -1056 1192 -508 442
-1098 612 -1737 501 -292 -50 -632 -194 -853 -360 -188 -141 -498 -435 -508
-482 -2 -9 23 -43 55 -77 32 -34 105 -115 163 -180 57 -64 110 -117 117 -117
7 0 79 67 161 148 421 419 834 591 1335 553 478 -36 786 -208 1262 -706 88
-92 187 -200 220 -241 33 -40 95 -115 138 -166 67 -81 293 -382 547 -729 41
-56 143 -187 227 -291 545 -679 944 -991 1431 -1121 114 -30 123 -31 342 -31
248 -1 303 8 490 76 523 190 892 663 999 1278 l16 95 1660 5 1660 5 55 30
c178 98 184 351 10 449 l-55 31 -1662 3 -1662 2 -5 33 c-3 17 -10 73 -17 122
-24 184 -108 453 -194 626 -368 736 -1198 1174 -2032 1073z"/>
        <path d="M5355 4174 c-357 -49 -576 -119 -841 -269 -478 -271 -849 -751 -974
-1262 -17 -67 -30 -134 -30 -148 l0 -25 269 0 268 0 37 118 c142 446 525 830
971 975 298 97 686 98 975 3 452 -148 935 -592 1555 -1430 94 -126 220 -290
280 -365 61 -75 126 -156 145 -181 139 -182 635 -650 689 -650 53 0 461 234
461 264 0 7 -15 23 -32 36 -190 138 -599 533 -774 746 -113 138 -233 294 -471
614 -269 363 -503 627 -823 930 -372 354 -729 546 -1155 621 -115 20 -466 35
-550 23z"/>
        <path d="M6909 2483 c-35 -49 -91 -122 -124 -163 -33 -41 -82 -105 -108 -142
-26 -37 -84 -112 -129 -165 -44 -54 -98 -120 -118 -148 -78 -105 -388 -435
-409 -435 -5 0 -53 35 -107 78 -657 518 -963 686 -1404 771 -164 32 -332 34
-2315 35 -2220 1 -2019 8 -2103 -69 -132 -118 -94 -342 70 -416 l53 -24 1635
-5 1634 -5 12 -45 c6 -25 17 -81 24 -125 30 -195 138 -463 263 -653 223 -338
517 -536 922 -623 104 -23 410 -17 532 9 92 20 330 105 415 148 64 32 198 125
198 138 0 7 -50 53 -110 102 -61 49 -148 119 -193 156 -87 72 -105 78 -165 52
-614 -262 -1183 51 -1328 732 -25 120 -26 118 111 111 484 -28 752 -158 1384
-671 68 -56 145 -116 170 -135 25 -19 102 -80 171 -136 581 -469 1036 -692
1597 -780 137 -22 480 -30 628 -16 570 56 1074 264 1610 666 347 260 923 859
1180 1226 22 32 70 96 108 143 37 48 67 89 67 92 0 19 -316 384 -333 384 -12
0 -50 -45 -109 -130 -51 -73 -194 -257 -303 -390 -388 -473 -796 -860 -1127
-1068 -38 -23 -96 -60 -130 -81 -103 -65 -325 -167 -458 -210 -603 -197 -1178
-155 -1728 124 -202 102 -452 264 -452 292 0 7 57 72 128 145 135 142 281 310
406 472 190 242 347 458 342 469 -15 36 -315 375 -332 376 -7 1 -40 -38 -75
-86z"/>
        <path d="M11955 913 c-177 -119 -514 -257 -740 -302 -352 -71 -760 -32 -1092
104 -35 14 -70 25 -79 25 -9 0 -65 -40 -125 -90 -59 -49 -157 -126 -218 -170
-61 -45 -111 -87 -111 -94 0 -11 206 -116 310 -157 322 -126 570 -174 905
-173 344 1 620 55 950 188 253 101 655 328 655 371 0 7 -21 31 -47 52 -27 21
-109 95 -184 165 -75 71 -140 128 -145 128 -5 0 -41 -21 -79 -47z"/>
      </g>
    </svg>
  );
}
