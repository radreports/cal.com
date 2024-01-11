import { Prisma } from "@prisma/client";
// eslint-disable-next-line no-restricted-imports
import { orderBy } from "lodash";

import { hasFilter } from "@calcom/features/filters/lib/hasFilter";
import { checkRateLimitAndThrowError } from "@calcom/lib/checkRateLimitAndThrowError";
import { isOrganization } from "@calcom/lib/entityPermissionUtils";
import { getTeamAvatarUrl, getUserAvatarUrl } from "@calcom/lib/getAvatarUrl";
import { getBookerBaseUrlSync } from "@calcom/lib/getBookerUrl/client";
import { getBookerBaseUrl } from "@calcom/lib/getBookerUrl/server";
import { markdownToSafeHTML } from "@calcom/lib/markdownToSafeHTML";
import { Profile } from "@calcom/lib/server/repository/profile";
import type { PrismaClient } from "@calcom/prisma";
import { baseEventTypeSelect } from "@calcom/prisma";
import { MembershipRole, SchedulingType } from "@calcom/prisma/enums";
import { teamMetadataSchema } from "@calcom/prisma/zod-utils";
import { EventTypeMetaDataSchema } from "@calcom/prisma/zod-utils";

import { TRPCError } from "@trpc/server";

import type { TrpcSessionUser } from "../../../trpc";
import type { TEventTypeInputSchema } from "./getByViewer.schema";

type GetByViewerOptions = {
  ctx: {
    user: NonNullable<TrpcSessionUser>;
    prisma: PrismaClient;
  };
  input: TEventTypeInputSchema;
};

export const compareMembership = (mship1: MembershipRole, mship2: MembershipRole) => {
  const mshipToNumber = (mship: MembershipRole) =>
    Object.keys(MembershipRole).findIndex((mmship) => mmship === mship);
  return mshipToNumber(mship1) > mshipToNumber(mship2);
};

export const getByViewerHandler = async ({ ctx, input }: GetByViewerOptions) => {
  const { prisma } = ctx;
  await checkRateLimitAndThrowError({
    identifier: `eventTypes:getByViewer:${ctx.user.id}`,
    rateLimitingType: "common",
  });
  const profile = ctx.user.profile;
  const userSelect = Prisma.validator<Prisma.UserSelect>()({
    id: true,
    username: true,
    name: true,
    avatarUrl: true,
    profiles: {
      ...(profile?.organization?.id ? { where: { organizationId: profile?.organization?.id } } : {}),
      include: {
        organization: {
          select: {
            id: true,
            slug: true,
          },
        },
      },
    },
  });

  const userEventTypeSelect = Prisma.validator<Prisma.EventTypeSelect>()({
    // Position is required by lodash to sort on it. Don't remove it, TS won't complain but it would silently break reordering
    position: true,
    hashedLink: true,
    destinationCalendar: true,
    userId: true,
    team: {
      select: {
        id: true,
        name: true,
        slug: true,
        // logo: true, // Skipping to avoid 4mb limit
        bio: true,
        hideBranding: true,
      },
    },
    metadata: true,
    users: {
      select: userSelect,
    },
    parentId: true,
    hosts: {
      select: {
        user: {
          select: userSelect,
        },
      },
    },
    seatsPerTimeSlot: true,
    ...baseEventTypeSelect,
  });

  const teamEventTypeSelect = Prisma.validator<Prisma.EventTypeSelect>()({
    ...userEventTypeSelect,
    children: {
      include: {
        users: {
          select: userSelect,
        },
      },
    },
  });

  const user = await prisma.user.findUnique({
    where: {
      id: ctx.user.id,
    },
    select: {
      id: true,
      avatarUrl: true,
      username: true,
      name: true,
      startTime: true,
      endTime: true,
      bufferTime: true,
      avatar: true,
      teams: {
        where: {
          accepted: true,
          team: {
            parentId: profile?.organization?.id ?? null,
          },
        },
        select: {
          role: true,
          team: {
            select: {
              id: true,
              name: true,
              slug: true,
              parentId: true,
              metadata: true,
              parent: true,
              members: {
                select: {
                  userId: true,
                },
              },
              eventTypes: {
                select: teamEventTypeSelect,
                orderBy: [
                  {
                    position: "desc",
                  },
                  {
                    id: "asc",
                  },
                ],
              },
            },
          },
        },
      },
      eventTypes: {
        where: {
          teamId: null,
          userId: getPrismaWhereUserIdFromFilter(ctx.user.id, input?.filters),
        },
        select: {
          ...userEventTypeSelect,
        },
        orderBy: [
          {
            position: "desc",
          },
          {
            id: "asc",
          },
        ],
      },
    },
  });

  if (!user) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  }

  const memberships = user.teams.map((membership) => ({
    ...membership,
    team: {
      ...membership.team,
      metadata: teamMetadataSchema.parse(membership.team.metadata),
    },
  }));

  type UserEventTypes = (typeof user.eventTypes)[number];
  type TeamEventTypeChildren = (typeof user.teams)[number]["team"]["eventTypes"][number];
  const mapEventType = async (eventType: UserEventTypes & Partial<TeamEventTypeChildren>) => ({
    ...eventType,
    safeDescription: eventType?.description ? markdownToSafeHTML(eventType.description) : undefined,
    users: await Promise.all(
      (!!eventType?.hosts?.length ? eventType?.hosts.map((host) => host.user) : eventType.users).map(
        async (u) => ({
          ...u,
          relevantProfile: await Profile.getRelevantOrgProfile({ userId: u.id, ownedByOrganizationId: null }),
        })
      )
    ),
    metadata: eventType.metadata ? EventTypeMetaDataSchema.parse(eventType.metadata) : undefined,
    children: await Promise.all(
      (eventType.children || []).map(async (c) => ({
        ...c,
        users: await Promise.all(
          c.users.map(async (u) => ({
            ...u,
            // TODO: OrgNewSchema - Later - Figure out which profile to use
            relevantProfile: await Profile.getRelevantOrgProfile({
              userId: u.id,
              ownedByOrganizationId: null,
            }),
          }))
        ),
      }))
    ),
  });

  const userEventTypes = await Promise.all(user.eventTypes.map(mapEventType));

  type EventTypeGroup = {
    teamId?: number | null;
    parentId?: number | null;
    bookerUrl: string;
    membershipRole?: MembershipRole | null;
    profile: {
      slug: (typeof user)["username"];
      name: (typeof user)["name"];
      image: string;
    };
    metadata: {
      membershipCount: number;
      readOnly: boolean;
    };
    eventTypes: typeof userEventTypes;
  };

  let eventTypeGroups: EventTypeGroup[] = [];

  const unmanagedEventTypes = userEventTypes.filter(
    (evType) => evType.schedulingType !== SchedulingType.MANAGED
  );

  if (!input?.filters || !hasFilter(input?.filters) || input?.filters?.userIds?.includes(user.id)) {
    const bookerUrl = await getBookerBaseUrl(profile?.organizationId ?? null);
    eventTypeGroups.push({
      teamId: null,
      bookerUrl,
      membershipRole: null,
      profile: {
        slug: profile?.username || user.username,
        name: user.name,
        image: getUserAvatarUrl({
          ...user,
          relevantProfile: profile,
        }),
      },
      eventTypes: orderBy(unmanagedEventTypes, ["position", "id"], ["desc", "asc"]),
      metadata: {
        membershipCount: 1,
        readOnly: false,
      },
    });
  }

  const teamMemberships = user.teams.map((membership) => ({
    teamId: membership.team.id,
    membershipRole: membership.role,
  }));

  const filterTeamsEventTypesBasedOnInput = async (eventType: Awaited<ReturnType<typeof mapEventType>>) => {
    if (!input?.filters || !hasFilter(input?.filters)) {
      return true;
    }
    return input?.filters?.teamIds?.includes(eventType?.team?.id || 0) ?? false;
  };
  eventTypeGroups = ([] as EventTypeGroup[]).concat(
    eventTypeGroups,
    await Promise.all(
      memberships
        .filter((mmship) => {
          if (isOrganization({ team: mmship.team })) {
            return false;
          } else {
            if (!input?.filters || !hasFilter(input?.filters)) {
              return true;
            }
            return input?.filters?.teamIds?.includes(mmship?.team?.id || 0) ?? false;
          }
        })
        .map(async (membership) => {
          const orgMembership = teamMemberships.find(
            (teamM) => teamM.teamId === membership.team.parentId
          )?.membershipRole;

          const team = {
            ...membership.team,
            metadata: teamMetadataSchema.parse(membership.team.metadata),
          };

          let slug;

          if (input?.forRoutingForms) {
            // For Routing form we want to ensure that after migration of team to an org, the URL remains same for the team
            // Once we solve this https://github.com/calcom/cal.com/issues/12399, we can remove this conditional change in slug
            slug = `team/${team.slug}`;
          } else {
            // In an Org, a team can be accessed without /team prefix as well as with /team prefix
            slug = team.slug ? (!team.parentId ? `team/${team.slug}` : `${team.slug}`) : null;
          }

          const eventTypes = await Promise.all(team.eventTypes.map(mapEventType));
          console.log("getByViewerHandler:EventTypes", eventTypes);
          return {
            teamId: team.id,
            parentId: team.parentId,
            bookerUrl: getBookerBaseUrlSync(team.parent?.slug ?? null),
            membershipRole:
              orgMembership && compareMembership(orgMembership, membership.role)
                ? orgMembership
                : membership.role,
            profile: {
              image: getTeamAvatarUrl({
                slug: team.slug,
                requestedSlug: team.metadata?.requestedSlug ?? null,
                organizationId: team.parentId,
              }),
              name: team.name,
              slug,
            },
            metadata: {
              membershipCount: team.members.length,
              readOnly:
                membership.role ===
                (team.parentId
                  ? orgMembership && compareMembership(orgMembership, membership.role)
                    ? orgMembership
                    : MembershipRole.MEMBER
                  : MembershipRole.MEMBER),
            },
            eventTypes: eventTypes
              .filter(filterTeamsEventTypesBasedOnInput)
              .filter((evType) => {
                const res = evType.userId === null || evType.userId === ctx.user.id;
                console.log("getByViewerHandler:filterTeamsEventTypesBasedOnInput", res, evType, ctx.user.id);
                return res;
              })
              .filter((evType) =>
                membership.role === MembershipRole.MEMBER
                  ? evType.schedulingType !== SchedulingType.MANAGED
                  : true
              ),
          };
        })
    )
  );

  return {
    eventTypeGroups,
    // so we can show a dropdown when the user has teams
    profiles: eventTypeGroups.map((group) => ({
      ...group.profile,
      ...group.metadata,
      teamId: group.teamId,
      membershipRole: group.membershipRole,
    })),
  };
};

export function getPrismaWhereUserIdFromFilter(
  userId: number,
  filters: NonNullable<TEventTypeInputSchema>["filters"] | undefined
) {
  if (!filters || !hasFilter(filters)) {
    return userId;
  } else if (filters.userIds?.[0] === userId) {
    return userId;
  }
  return 0;
}
