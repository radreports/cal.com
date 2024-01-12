import { Prisma } from "@prisma/client";

import { getAppFromSlug } from "@calcom/app-store/utils";
import prisma, { baseEventTypeSelect } from "@calcom/prisma";
import type { Team } from "@calcom/prisma/client";
import { SchedulingType } from "@calcom/prisma/enums";
import { EventTypeMetaDataSchema } from "@calcom/prisma/zod-utils";

import { WEBAPP_URL } from "../../../constants";
import { getBookerBaseUrlSync } from "../../../getBookerUrl/client";
import { getTeam, getOrg } from "../../repository/team";
import { User } from "../../repository/user";

export type TeamWithMembers = Awaited<ReturnType<typeof getTeamWithMembers>>;

export async function getTeamWithMembers(args: {
  id?: number;
  slug?: string;
  userId?: number;
  orgSlug?: string | null;
  includeTeamLogo?: boolean;
  isTeamView?: boolean;
  currentOrg?: Team | null;
  /**
   * If true, means that you are fetching an organization and not a team
   */
  isOrgView?: boolean;
}) {
  const { id, slug, currentOrg, userId, orgSlug, isTeamView, isOrgView, includeTeamLogo } = args;

  // This should improve performance saving already app data found.
  const appDataMap = new Map();
  const userSelect = Prisma.validator<Prisma.UserSelect>()({
    username: true,
    email: true,
    name: true,
    avatarUrl: true,
    id: true,
    bio: true,
    teams: {
      select: {
        team: {
          select: {
            slug: true,
            id: true,
          },
        },
      },
    },
    credentials: {
      select: {
        app: {
          select: {
            slug: true,
            categories: true,
          },
        },
        destinationCalendars: {
          select: {
            externalId: true,
          },
        },
      },
    },
  });
  let lookupBy;

  if (id) {
    lookupBy = { id, havingMemberWithId: userId };
  } else if (slug) {
    lookupBy = { slug, havingMemberWithId: userId };
  } else {
    throw new Error("Must provide either id or slug");
  }

  const arg = {
    lookupBy,
    forOrgWithSlug: orgSlug ?? null,
    isOrg: !!isOrgView,
    teamSelect: {
      id: true,
      name: true,
      slug: true,
      ...(!!includeTeamLogo ? { logo: true } : {}),
      bio: true,
      hideBranding: true,
      hideBookATeamMember: true,
      isPrivate: true,
      metadata: true,
      parent: {
        select: {
          id: true,
          slug: true,
          name: true,
        },
      },
      children: {
        select: {
          name: true,
          slug: true,
        },
      },
      members: {
        select: {
          accepted: true,
          role: true,
          disableImpersonation: true,
          user: {
            select: userSelect,
          },
        },
      },
      theme: true,
      brandColor: true,
      darkBrandColor: true,
      eventTypes: {
        where: {
          hidden: false,
          schedulingType: {
            not: SchedulingType.MANAGED,
          },
        },
        select: {
          users: {
            select: userSelect,
          },
          metadata: true,
          ...baseEventTypeSelect,
        },
      },
      inviteTokens: {
        select: {
          token: true,
          expires: true,
          expiresInDays: true,
          identifier: true,
        },
      },
    },
  } as const;

  const teamOrOrg = isOrgView ? await getOrg(arg) : await getTeam(arg);

  if (!teamOrOrg) return null;
  const currentOrgId = currentOrg?.id ?? (isOrgView ? teamOrOrg.id : teamOrOrg.parent?.id) ?? null;
  const members = await Promise.all(
    teamOrOrg.members.map(async (m) => {
      const user = await User.enrichUserWithOrganizationProfile({
        user: m.user,
        organizationId: currentOrgId,
      });

      const { credentials, ...restUser } = user;
      return {
        ...restUser,
        username: user.profile?.username ?? restUser.username,
        role: m.role,
        profile: user.profile,
        organizationId: user.profile?.organizationId ?? null,
        organization: user.profile?.organization,
        accepted: m.accepted,
        disableImpersonation: m.disableImpersonation,
        subteams: orgSlug
          ? user.teams
              .filter((membership) => membership.team.id !== teamOrOrg.id)
              .map((membership) => membership.team.slug)
          : null,
        avatar: `${WEBAPP_URL}/${user.username}/avatar.png`,
        bookerUrl: getBookerBaseUrlSync(user.profile?.organization?.slug || ""),
        connectedApps: !isTeamView
          ? credentials?.map((cred) => {
              const appSlug = cred.app?.slug;
              let appData = appDataMap.get(appSlug);

              if (!appData) {
                appData = getAppFromSlug(appSlug);
                appDataMap.set(appSlug, appData);
              }

              const isCalendar = cred?.app?.categories?.includes("calendar") ?? false;
              const externalId = isCalendar ? cred.destinationCalendars?.[0]?.externalId : null;
              return {
                name: appData?.name ?? null,
                logo: appData?.logo ?? null,
                app: cred.app,
                externalId: externalId ?? null,
              };
            })
          : null,
      };
    })
  );

  const eventTypes = await Promise.all(
    teamOrOrg.eventTypes.map(async (eventType) => {
      return {
        ...eventType,
        users: await Promise.all([
          ...eventType.users.map(
            async (user) =>
              await User.enrichUserWithOrganizationProfile({
                user: user,
                organizationId: currentOrgId,
              })
          ),
        ]),
        metadata: EventTypeMetaDataSchema.parse(eventType.metadata),
      };
    })
  );

  // Don't leak invite tokens to the frontend
  const { inviteTokens, ...teamWithoutInviteTokens } = teamOrOrg;

  // Don't leak stripe payment ids
  const teamMetadata = teamOrOrg.metadata;
  const {
    paymentId: _,
    subscriptionId: __,
    subscriptionItemId: ___,
    ...restTeamMetadata
  } = teamMetadata || {};

  return {
    ...teamWithoutInviteTokens,
    /** To prevent breaking we only return non-email attached token here, if we have one */
    inviteToken: inviteTokens.find(
      (token) =>
        token.identifier === `invite-link-for-teamId-${teamOrOrg.id}` &&
        token.expires > new Date(new Date().setHours(24))
    ),
    metadata: restTeamMetadata,
    eventTypes: !isOrgView ? eventTypes : null,
    members,
  };
}

// also returns team
export async function isTeamAdmin(userId: number, teamId: number) {
  const team = await prisma.membership.findFirst({
    where: {
      userId,
      teamId,
      accepted: true,
      OR: [{ role: "ADMIN" }, { role: "OWNER" }],
    },
    include: { team: true },
  });
  if (!team) return false;
  return team;
}

export async function isTeamOwner(userId: number, teamId: number) {
  return !!(await prisma.membership.findFirst({
    where: {
      userId,
      teamId,
      accepted: true,
      role: "OWNER",
    },
  }));
}

export async function isTeamMember(userId: number, teamId: number) {
  return !!(await prisma.membership.findFirst({
    where: {
      userId,
      teamId,
      accepted: true,
    },
  }));
}
