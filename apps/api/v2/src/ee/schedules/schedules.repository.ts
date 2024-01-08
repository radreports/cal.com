import { CreateAvailabilityInput } from "@/ee/availabilities/inputs/create-availability.input";
import { CreateScheduleInput } from "@/ee/schedules/inputs/create-schedule.input";
import { UpdateScheduleInput } from "@/ee/schedules/inputs/update-schedule.input";
import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";
import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

@Injectable()
export class SchedulesRepository {
  constructor(private readonly dbRead: PrismaReadService, private readonly dbWrite: PrismaWriteService) {}

  async createScheduleWithAvailabilities(
    userId: number,
    schedule: CreateScheduleInput,
    availabilities: CreateAvailabilityInput[]
  ) {
    const createdSchedule = await this.dbWrite.prisma.schedule.create({
      data: {
        user: {
          connect: {
            id: userId,
          },
        },
        ...schedule,
        availability: {
          createMany: {
            data: availabilities.map((availability) => {
              return {
                ...availability,
                userId,
              };
            }),
          },
        },
      },
      include: {
        availability: {
          select: {
            id: true,
            days: true,
            startTime: true,
            endTime: true,
          },
        },
      },
    });

    return createdSchedule;
  }

  async getScheduleById(scheduleId: number) {
    const schedule = await this.dbRead.prisma.schedule.findUnique({
      where: {
        id: scheduleId,
      },
      include: {
        availability: {
          select: {
            id: true,
            days: true,
            startTime: true,
            endTime: true,
          },
        },
      },
    });

    return schedule;
  }

  async getSchedulesByUserId(userId: number) {
    const schedules = await this.dbRead.prisma.schedule.findMany({
      where: {
        userId,
      },
      include: {
        availability: {
          select: {
            id: true,
            days: true,
            startTime: true,
            endTime: true,
          },
        },
      },
    });

    return schedules;
  }

  async updateScheduleWithAvailabilities(scheduleId: number, schedule: UpdateScheduleInput) {
    const existingSchedule = await this.dbRead.prisma.schedule.findUnique({
      where: { id: scheduleId },
    });

    if (!existingSchedule) {
      throw new BadRequestException(`Schedule with ID=${scheduleId} not found`);
    }

    const updatedScheduleData: Prisma.ScheduleUpdateInput = {};
    if (schedule.name) updatedScheduleData.name = schedule.name;
    if (schedule.timeZone) updatedScheduleData.timeZone = schedule.timeZone;

    if (schedule.availabilities && schedule.availabilities.length > 0) {
      await this.dbWrite.prisma.availability.deleteMany({
        where: { scheduleId },
      });

      updatedScheduleData.availability = {
        createMany: {
          data: schedule.availabilities.map((availability) => ({
            ...availability,
            scheduleId,
          })),
        },
      };
    }

    const updatedSchedule = this.dbWrite.prisma.schedule.update({
      where: { id: scheduleId },
      data: updatedScheduleData,
      include: {
        availability: {
          select: {
            id: true,
            days: true,
            startTime: true,
            endTime: true,
          },
        },
      },
    });

    return updatedSchedule;
  }

  async deleteScheduleById(scheduleId: number) {
    return this.dbWrite.prisma.schedule.delete({
      where: {
        id: scheduleId,
      },
    });
  }
}
