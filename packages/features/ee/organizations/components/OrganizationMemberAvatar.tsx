import classNames from "@calcom/lib/classNames";
import { getOrgAvatarUrl } from "@calcom/lib/getAvatarUrl";
import type { RelevantProfile } from "@calcom/types/RelevantProfile";
// import { Avatar } from "@calcom/ui";
import { UserAvatar } from "@calcom/web/components/ui/avatar/UserAvatar";

type WithoutOrganizationRelevantProfile = Omit<NonNullable<RelevantProfile>, "organization">;
type UserAvatarProps = React.ComponentProps<typeof UserAvatar>;
type OrganizationMemberAvatarProps = Omit<UserAvatarProps, "user"> & {
  user: UserAvatarProps["user"] & {
    relevantProfile:
      | (WithoutOrganizationRelevantProfile & {
          organization: {
            slug: string | null;
            requestedSlug: string | null;
          };
        })
      | null;
  };
};

/**
 * Shows the user's avatar along with a small organization's avatar
 */
const OrganizationMemberAvatar = ({ size, user, previewSrc, ...rest }: OrganizationMemberAvatarProps) => {
  const organization = user.relevantProfile?.organization;
  return (
    <UserAvatar
      data-testid="organization-avatar"
      size={size}
      user={user}
      previewSrc={previewSrc}
      indicator={
        organization ? (
          <div
            className={classNames("absolute bottom-0 right-0 z-10", size === "lg" ? "h-6 w-6" : "h-10 w-10")}>
            <img
              src={getOrgAvatarUrl(organization)}
              alt={user.username || ""}
              className="flex h-full items-center justify-center rounded-full"
            />
          </div>
        ) : null
      }
      {...rest}
    />
  );
};

export default OrganizationMemberAvatar;
