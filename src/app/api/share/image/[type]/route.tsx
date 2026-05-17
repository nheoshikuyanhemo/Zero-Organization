import { NextRequest } from "next/server";
import { publicConfig } from "@/config/public-config";
import {
  getShareImageResponse,
  parseNextRequestSearchParams,
} from "@/neynar-farcaster-sdk/nextjs";

// Cache for 1 hour - query strings create separate cache entries
export const revalidate = 3600;

const { appEnv, heroImageUrl, imageUrl } = publicConfig;

const showDevWarning = appEnv !== "production";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ type: string }> },
) {
  const { type } = await params;

  const searchParams = parseNextRequestSearchParams(request);
  const zpoints = searchParams.zpoints ?? "0";
  const streak = searchParams.streak ?? "0";

  return getShareImageResponse(
    { type, heroImageUrl, imageUrl, showDevWarning },
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "flex-end",
        width: "100%",
        height: "100%",
        padding: 48,
        backgroundColor: "rgba(0,0,0,0.72)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 0,
          border: "1px solid rgba(0,255,65,0.35)",
          borderRadius: 4,
          padding: "28px 36px",
          backgroundColor: "rgba(0,0,0,0.85)",
          boxShadow: "0 0 32px rgba(0,255,65,0.18), 0 0 2px rgba(0,255,65,0.4)",
        }}
      >
        {/* ZORG title */}
        <div
          style={{
            display: "flex",
            fontSize: 72,
            fontWeight: 900,
            color: "#00ff41",
            letterSpacing: 8,
            lineHeight: 1,
            textShadow: "0 0 24px #00ff41, 0 0 48px #00ff41",
            fontFamily: "monospace",
          }}
        >
          ZORG
        </div>

        {/* Divider */}
        <div
          style={{
            display: "flex",
            width: "100%",
            height: 1,
            backgroundColor: "rgba(0,255,65,0.25)",
            marginTop: 20,
            marginBottom: 20,
          }}
        />

        {/* Stats row */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            gap: 48,
            alignItems: "flex-start",
          }}
        >
          {/* Zpoints */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: 13,
                color: "rgba(0,255,65,0.5)",
                letterSpacing: 3,
                textTransform: "uppercase",
                fontFamily: "monospace",
              }}
            >
              ZPOINTS
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 44,
                fontWeight: 700,
                color: "#00ff41",
                fontFamily: "monospace",
                textShadow: "0 0 12px rgba(0,255,65,0.6)",
                lineHeight: 1,
              }}
            >
              {parseInt(zpoints).toLocaleString()}
            </div>
          </div>

          {/* Vertical separator */}
          <div
            style={{
              display: "flex",
              width: 1,
              alignSelf: "stretch",
              backgroundColor: "rgba(0,255,65,0.2)",
            }}
          />

          {/* Streak */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: 13,
                color: "rgba(0,255,65,0.5)",
                letterSpacing: 3,
                textTransform: "uppercase",
                fontFamily: "monospace",
              }}
            >
              STREAK
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 44,
                fontWeight: 700,
                color: "#00ff41",
                fontFamily: "monospace",
                textShadow: "0 0 12px rgba(0,255,65,0.6)",
                lineHeight: 1,
              }}
            >
              {streak}
              <span
                style={{
                  display: "flex",
                  fontSize: 22,
                  color: "rgba(0,255,65,0.55)",
                  alignSelf: "flex-end",
                  paddingBottom: 4,
                  paddingLeft: 6,
                  fontFamily: "monospace",
                }}
              >
                days
              </span>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div
          style={{
            display: "flex",
            width: "100%",
            height: 1,
            backgroundColor: "rgba(0,255,65,0.15)",
            marginTop: 20,
            marginBottom: 14,
          }}
        />

        {/* Tagline */}
        <div
          style={{
            display: "flex",
            fontSize: 14,
            color: "rgba(0,255,65,0.4)",
            letterSpacing: 2,
            textTransform: "uppercase",
            fontFamily: "monospace",
          }}
        >
          Zero Organization. Maximum Points.
        </div>
      </div>
    </div>,
  );
}
