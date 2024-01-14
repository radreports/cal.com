import { Profile } from "@calcom/lib/server/repository/profile";
import { prisma } from "@calcom/prisma";
import type { Profile as ProfileType } from "@calcom/prisma/client";
import type { PrismaPromise } from "@calcom/prisma/client";

export async function joinAnyChildTeamOnOrgInvite({ userId, orgId }: { userId: number; orgId: number }) {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
  });
  if (!user) {
    throw new Error("User not found");
  }

  await prisma.$transaction([
    // Simply remove this update when we remove the `organizationId` field from the user table
    prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        organizationId: orgId,
      },
    }),
    Profile.create({
      userId: userId,
      organizationId: orgId,
      email: user.email,
      username: user.username,
    }) as PrismaPromise<ProfileType>,
    prisma.membership.updateMany({
      where: {
        userId,
        team: {
          id: orgId,
        },
        accepted: false,
      },
      data: {
        accepted: true,
      },
    }),
    prisma.membership.updateMany({
      where: {
        userId,
        team: {
          parentId: orgId,
        },
        accepted: false,
      },
      data: {
        accepted: true,
      },
    }),
  ]);
}
