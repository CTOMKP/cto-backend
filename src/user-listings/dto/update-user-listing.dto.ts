import { PartialType } from '@nestjs/swagger';
import { CreateUserListingDto } from './create-user-listing.dto';

export class UpdateUserListingDto extends PartialType(CreateUserListingDto) {}