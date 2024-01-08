import type { Session } from "next-auth";

import { WEBAPP_URL } from "@calcom/lib/constants";
import logger from "@calcom/lib/logger";
import { Profile } from "@calcom/lib/server/repository/profile";
import { teamMetadataSchema, userMetadata } from "@calcom/prisma/zod-utils";

import type { Maybe } from "@trpc/server";
import { TRPCError } from "@trpc/server";

import type { TRPCContextInner } from "../createContext";
import { middleware } from "../trpc";

export async function getUserFromSession(ctx: TRPCContextInner, session: Maybe<Session>) {
  const { prisma } = ctx;
  if (!session?.user?.id) {
    return null;
  }

  const profile = session?.profileId ? await Profile.getProfile(session.profileId) : null;

  const user = await prisma.user.findUnique({
    where: {
      id: session.user.id,
      // Locked users can't login
      locked: false,
    },
    select: {
      id: true,
      username: true,
      name: true,
      email: true,
      emailVerified: true,
      bio: true,
      avatarUrl: true,
      timeZone: true,
      weekStart: true,
      startTime: true,
      endTime: true,
      defaultScheduleId: true,
      bufferTime: true,
      theme: true,
      createdDate: true,
      hideBranding: true,
      twoFactorEnabled: true,
      disableImpersonation: true,
      identityProvider: true,
      brandColor: true,
      darkBrandColor: true,
      away: true,
      selectedCalendars: {
        select: {
          externalId: true,
          integration: true,
        },
      },
      completedOnboarding: true,
      destinationCalendar: true,
      locale: true,
      timeFormat: true,
      trialEndsAt: true,
      metadata: true,
      role: true,
      allowDynamicBooking: true,
      allowSEOIndexing: true,
      receiveMonthlyDigestEmail: true,
    },
  });

  // some hacks to make sure `username` and `email` are never inferred as `null`
  if (!user) {
    return null;
  }

  const { email, username, id } = user;
  if (!email || !id) {
    return null;
  }

  const userMetaData = userMetadata.parse(user.metadata || {});
  const orgMetadata = teamMetadataSchema.parse(profile?.organization?.metadata || {});
  // This helps to prevent reaching the 4MB payload limit by avoiding base64 and instead passing the avatar url

  const locale = user?.locale ?? ctx.locale;

  const isOrgAdmin = !!profile?.organization?.members.length;
  // Want to reduce the amount of data being sent
  if (isOrgAdmin && profile?.organization?.members) {
    profile.organization.members = [];
  }
  const organization = {
    ...profile?.organization,
    id: profile?.organization?.id ?? null,
    isOrgAdmin,
    metadata: orgMetadata,
    requestedSlug: orgMetadata?.requestedSlug ?? null,
  };
  return {
    ...user,
    avatar: `${WEBAPP_URL}/${user.username}/avatar.png?${organization.id}` && `orgId=${organization.id}`,
    // FIXME: Remove this
    organization,
    organizationId: organization.id,
    id,
    email,
    username,
    locale,
    defaultBookerLayouts: userMetaData?.defaultBookerLayouts || null,
    profile: profile
      ? {
          ...profile,
          organization: {
            ...profile.organization,
            requestedSlug: organization.requestedSlug,
          },
        }
      : null,
  };
}

export type UserFromSession = Awaited<ReturnType<typeof getUserFromSession>>;

const getSession = async (ctx: TRPCContextInner) => {
  const { req, res } = ctx;
  const { getServerSession } = await import("@calcom/features/auth/lib/getServerSession");
  return req ? await getServerSession({ req, res }) : null;
};

const getUserSession = async (ctx: TRPCContextInner) => {
  /**
   * It is possible that the session and user have already been added to the context by a previous middleware
   * or when creating the context
   */
  const session = ctx.session || (await getSession(ctx));
  const user = session ? await getUserFromSession(ctx, session) : null;
  let foundProfile = null;
  if (session?.profileId) {
    foundProfile = await ctx.prisma.profile.findUnique({
      where: {
        id: session.profileId,
        userId: user?.id,
      },
    });
    if (!foundProfile) {
      logger.error("Profile not found", { profileId: session.profileId, userId: user?.id });
      // TODO: Test that logout should happen automatically
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
  }
  return { user, session };
};

const sessionMiddleware = middleware(async ({ ctx, next }) => {
  const middlewareStart = performance.now();
  const { user, session } = await getUserSession(ctx);
  const middlewareEnd = performance.now();
  logger.debug("Perf:t.sessionMiddleware", middlewareEnd - middlewareStart);
  return next({
    ctx: { user, session },
  });
});

export const isAuthed = middleware(async ({ ctx, next }) => {
  const middlewareStart = performance.now();

  const { user, session } = await getUserSession(ctx);

  const middlewareEnd = performance.now();
  logger.debug("Perf:t.isAuthed", middlewareEnd - middlewareStart);

  if (!user || !session) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  return next({
    ctx: { ...ctx, user, session },
  });
});

export const isAdminMiddleware = isAuthed.unstable_pipe(({ ctx, next }) => {
  const { user } = ctx;
  if (user?.role !== "ADMIN") {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, user: user } });
});

// Org admins can be admins or owners
export const isOrgAdminMiddleware = isAuthed.unstable_pipe(({ ctx, next }) => {
  const { user } = ctx;
  if (!user?.organization?.isOrgAdmin) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, user: user } });
});

export default sessionMiddleware;
