import { useRouter } from "next/router";
import { useState } from "react";
import { useFormContext, Controller } from "react-hook-form";

import MemberInvitationModal from "@calcom/features/ee/teams/components/MemberInvitationModal";
import { classNames } from "@calcom/lib";
import { WEBAPP_URL } from "@calcom/lib/constants";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { trpc } from "@calcom/trpc/react";
import { Icon } from "@calcom/ui";
import { Avatar, Badge, Button, showToast } from "@calcom/ui/v2/core";
import { SkeletonContainer, SkeletonText, SkeletonAvatar } from "@calcom/ui/v2/core/skeleton";

import { NewTeamFormValues } from "../../lib/types";
import { NewMemberForm } from "../MemberInvitationModal";

const AddNewTeamMembers = () => {
  const { t } = useLocale();
  const utils = trpc.useContext();
  const router = useRouter();

  const [memberInviteModal, setMemberInviteModal] = useState(false);
  const [inviteMemberUsername, setInviteMemberUsername] = useState("");
  const [skeletonMember, setSkeletonMember] = useState(false);

  const formMethods = useFormContext<NewTeamFormValues>();

  const { data: user } = trpc.useQuery(["viewer.me"]);

  const { data: newMember } = trpc.useQuery(["viewer.teams.findUser", { username: inviteMemberUsername }], {
    refetchOnWindowFocus: false,
    enabled: false,
  });

  // const { data: team, isLoading } = trpc.useQuery(["viewer.teams.get", { teamId }]);
  // const removeMemberMutation = trpc.useMutation("viewer.teams.removeMember", {
  //   onSuccess() {
  //     utils.invalidateQueries(["viewer.teams.get", { teamId }]);
  //     utils.invalidateQueries(["viewer.teams.list"]);
  //   },
  // });
  // const teamCheckoutMutation = trpc.useMutation("viewer.teams.purchaseTeamSubscription", {
  //   onSuccess: (data) => {
  //     if (data?.url) {
  //       router.push(data.url);
  //     }
  //   },
  //   onError: (err) => {
  //     showToast(err.message, "error");
  //   },
  // });

  // TODO handle processing new members as either email or username

  const handleInviteTeamMember = (values: NewMemberForm) => {
    console.log(values);
    setMemberInviteModal(false);
    setSkeletonMember(true);
  };

  // if (isLoading) return <AddNewTeamMemberSkeleton />;

  return (
    <>
      <Controller
        name="members"
        control={formMethods.control}
        defaultValue={[
          {
            name: user?.name || "",
            username: user?.username || "",
            email: user?.email || "",
            role: "OWNER",
            avatar: user?.avatar || "",
          },
        ]}
        render={({ field: { value } }) => (
          <>
            <div>
              <ul className="rounded-md border">
                {value.map((member, index) => (
                  <li
                    key={member.email}
                    className={classNames(
                      "flex items-center justify-between p-6 text-sm",
                      index !== 0 && "border-t"
                    )}>
                    <div className="flex space-x-2">
                      <Avatar
                        gravatarFallbackMd5="teamMember"
                        size="mdLg"
                        imageSrc={WEBAPP_URL + "/" + member.username + "/avatar.png"}
                        alt="owner-avatar"
                      />
                      <div>
                        <div className="flex space-x-1">
                          <p>{member?.name || t("team_member")}</p>
                          {/* Assume that the first member of the team is the creator */}
                          {index === 0 && <Badge variant="green">{t("you")}</Badge>}{" "}
                          {member.role !== "OWNER" && <Badge variant="orange">{t("pending")}</Badge>}
                          {member.role === "MEMBER" && <Badge variant="gray">{t("member")}</Badge>}
                          {member.role === "ADMIN" && <Badge variant="default">{t("admin")}</Badge>}
                        </div>
                        {member.username ? (
                          <p className="text-gray-600">{`${WEBAPP_URL}/${member?.username}`}</p>
                        ) : (
                          <p className="text-gray-600">{t("not_on_cal")}</p>
                        )}
                      </div>
                    </div>
                    {member.role !== "OWNER" && (
                      <Button
                        StartIcon={Icon.FiTrash2}
                        size="icon"
                        color="secondary"
                        className="h-[36px] w-[36px]"
                        onClick={() => removeMemberMutation.mutate({ teamId, memberId: member.id })}
                      />
                    )}
                  </li>
                ))}
                {skeletonMember && <SkeletonMember />}
              </ul>

              <Button
                color="secondary"
                data-testid="new-member-button"
                StartIcon={Icon.FiPlus}
                onClick={() => setMemberInviteModal(true)}
                className="mt-6 w-full justify-center">
                {t("add_team_member")}
              </Button>
            </div>

            <MemberInvitationModal
              isOpen={memberInviteModal}
              onExit={() => setMemberInviteModal(false)}
              onSubmit={handleInviteTeamMember}
            />
          </>
        )}
      />
    </>
  );

  // return (
  //   <Suspense fallback={<AddNewTeamMemberSkeleton />}>
  //     <>
  //       <>
  //         <ul className="rounded-md border">
  //           {team?.members.map((member, index) => (
  //             <li
  //               key={member.id}
  //               className={classNames(
  //                 "flex items-center justify-between p-6 text-sm",
  //                 index !== 0 && "border-t"
  //               )}>
  //               <div className="flex space-x-2">
  //                 <Avatar
  //                   gravatarFallbackMd5="teamMember"
  //                   size="mdLg"
  //                   imageSrc={WEBAPP_URL + "/" + member.username + "/avatar.png"}
  //                   alt="owner-avatar"
  //                 />
  //                 <div>
  //                   <div className="flex space-x-1">
  //                     <p>{member?.name || t("team_member")}</p>
  //                     {/* Assume that the first member of the team is the creator */}
  //                     {index === 0 && <Badge variant="green">{t("you")}</Badge>}
  //                     {!member.accepted && <Badge variant="orange">{t("pending")}</Badge>}
  //                     {member.role === "MEMBER" && <Badge variant="gray">{t("member")}</Badge>}
  //                     {member.role === "ADMIN" && <Badge variant="default">{t("admin")}</Badge>}
  //                   </div>
  //                   {member.username ? (
  //                     <p className="text-gray-600">{`${WEBAPP_URL}/${member?.username}`}</p>
  //                   ) : (
  //                     <p className="text-gray-600">{t("not_on_cal")}</p>
  //                   )}
  //                 </div>
  //               </div>
  //               {member.role !== "OWNER" && (
  //                 <Button
  //                   StartIcon={Icon.FiTrash2}
  //                   size="icon"
  //                   color="secondary"
  //                   className="h-[36px] w-[36px]"
  //                   onClick={() => removeMemberMutation.mutate({ teamId, memberId: member.id })}
  //                 />
  //               )}
  //             </li>
  //           ))}
  //         </ul>

  //         <Button
  //           color="secondary"
  //           data-testid="new-member-button"
  //           StartIcon={Icon.FiPlus}
  //           onClick={() => setMemberInviteModal(true)}
  //           className="mt-6 w-full justify-center">
  //           {t("add_team_member")}
  //         </Button>
  //       </>

  //       {team && (
  //         <MemberInvitationModal
  //           isOpen={memberInviteModal}
  //           onExit={() => setMemberInviteModal(false)}
  //           team={team}
  //           currentMember={team?.membership.role}
  //         />
  //       )}

  //       <hr className="my-6  border-neutral-200" />

  //       <Button
  //         EndIcon={Icon.FiArrowRight}
  //         className="mt-6 w-full justify-center"
  //         onClick={() => {
  //           if (team) {
  //             teamCheckoutMutation.mutate({ teamId, seats: team.members.length });
  //           } else {
  //             showToast(t("error_creating_team"), "error");
  //           }
  //         }}>
  //         {t("checkout")}
  //       </Button>
  //     </>
  //   </Suspense>
  // );
};

export default AddNewTeamMembers;

const AddNewTeamMemberSkeleton = () => {
  return (
    <SkeletonContainer className="rounded-md border">
      <div className="flex w-full justify-between p-4">
        <div>
          <p className="text-sm font-medium text-gray-900">
            <SkeletonText className="h-4 w-56" />
          </p>
          <div className="mt-2.5 w-max">
            <SkeletonText className="h-5 w-28" />
          </div>
        </div>
      </div>
    </SkeletonContainer>
  );
};

const SkeletonMember = () => {
  return (
    <SkeletonContainer className="rounded-md border-t text-sm">
      <div className="flex items-center justify-between p-5">
        <div className="flex">
          <SkeletonAvatar className="h-10 w-10" />
          <div>
            <p>
              <SkeletonText className="h-4 w-56" />
            </p>
            <p>
              <SkeletonText className="h-4 w-56" />
            </p>
          </div>
        </div>
        <SkeletonText className="h-7 w-7" />
      </div>
    </SkeletonContainer>
  );
};
