import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import { GetPlayersFilterDto } from "./dto-players/get-player-filter.dto";
import { Player } from "./player.entity";
import { PlayerRepository } from "./player.repository";
import { UserStatus } from "./player_status.enum";

import { authenticator } from 'otplib';
// import QRCode from 'qrcode';
const QRCode = require('qrcode');
import * as dotenv from "dotenv";
dotenv.config({ path: `.env` })

@Injectable()
export class UsersService {
	constructor(
		@InjectRepository(PlayerRepository)
		private userRepository: PlayerRepository,
		// private readonly twofactorService: TwoFactorAuthenticationService,
		private jwtService: JwtService,
	) {}
	
	async getStatusByUserId(id:number):Promise<UserStatus>{
		const user = await this.getUserById(id);
		const status = user.status;

		return status;
	}

	async getUserById(id: number): Promise<Player> {
		const found = await this.userRepository.findOne(id);
		if (!found){
			throw new NotFoundException(`User with ID "${id}" not found`);
		}
		return found;
	}

	async getUserByUsername(username:string): Promise<Player> {
		const found = await this.userRepository.findOne({username:username});
		if (!found){
			throw new NotFoundException(`User with ID "${username}" not found`);
		}
		return found;
	}

	async getUserByStatusId(id:number): Promise<Player> {
		const found = await this.userRepository.findOne({ where: { id: id, status: UserStatus.ONLINE } });
		if (!found){
			throw new NotFoundException(`User with ID "${id}" not found`);
		}
		return found;
	}

	async getUsers(FilterDto: GetPlayersFilterDto):Promise<Player[]> {
		return this.userRepository.getUsers(FilterDto);
	}

	async updateUsersStatus() {
		const onlineUsers = await this.userRepository.find({ where: { status: UserStatus.ONLINE } });
		for (const user of onlineUsers) {
			const now = new Date();
			const diff = now.getTime() - user.last_activity.getTime();
			if (diff > 1000 * 60 * 500) {
				await this.updateStatus(user.id, UserStatus.OFFLINE);
				console.log('User ' + user.username + ' is offline');
			}
		}
	}

	async updateUsername(id: number, username: string): Promise<Player> {

		const updated = await this.getUserById(id);
		var regEx = /^[0-9a-zA-Z]+$/;
		if (!regEx.test(username)) {
			throw new BadRequestException('Username must be alphanumeric');
		}
		updated.username = username;
		try {
			await updated.save();
		} catch (error) {
			console.log(error.code);
			if (error.code === '23505') {
				throw new BadRequestException('Username already exists');
			} else {
				throw new InternalServerErrorException();
			}
		}
		return updated;
	}

	async updateAvatar(id: number, avatar: string): Promise<Player> {

		const updated = await this.getUserById(id);
		updated.avatar = avatar;
		await updated.save();
		return updated;
	}

	async updateLevel(id: number, difficult: boolean): Promise<Player> {
		const updated = await this.getUserById(id);
		if (updated) {
			updated.level = updated.level + (difficult ? 0.15 : 0.10);
			await updated.save();
		}
		return updated;
	}

	async winsGame(id: number): Promise<Player> {
		const updated = await this.getUserById(id);
		if (updated) {
			updated.wins++;
			await updated.save();
		}
		return updated;
	}

	async LostGame(id: number): Promise<Player> {
		const updated = await this.getUserById(id);
		if (updated) {
			updated.losses++;
			await updated.save();
		}
		return updated;
	}

	async updateStatus(id: number, status: UserStatus): Promise<Player> {
		const updated = await this.getUserById(id);
		if (updated) {
			updated.status = status;
			await updated.save();
		}
		return updated;
	}

	async getAchievements(id: number): Promise<any> {
		const achievements = ['gold', 'silver', 'bronze', 'first'];
		const user = await this.userRepository.findOne(id);
		let s: number = 0;
		if (user.wins >= 20)
			s = -4;
		else if (user.wins >= 10)
			s = -3;
		else if (user.wins >= 5)
			s = -2;
		else if (user.wins >= 1 && user.wins < 5)
			s = -1;
		else
			s = 4;
		return achievements.slice(s);
	}

	async findPlayer(id: number): Promise<Player> {
		const found = await this.userRepository.findOne({ where: { id } });
		return found;
	}

	async findOrCreate(id: number, login: string): Promise<Player> {
		const found = await this.userRepository.findOne({ where: { id } });
		if (found) {
			return found;
		}
		console.log('create new user');
		const newUser = new Player();
		newUser.id = id;
		newUser.username = login;
		newUser.avatar = "https://avatars.dicebear.com/api/croodles/" + login + ".svg";
		newUser.level = 0.0;
		newUser.wins = 0;
		newUser.losses = 0;
		newUser.two_fa = false;
		try {
			await newUser.save();
		} catch (error) {
			console.log(error.code);
			throw new BadRequestException();
		}
		// if (typeof(newUser) == 'undefined') {
		// 	console.log('newUser is undefined');
		// }
		return newUser;
	}

	async verifyToken(token: string): Promise<Player> {

		// console.log('verifyToken');
		try {
			const decoded = await this.jwtService.verify(token.toString());
			if (typeof decoded === 'object' && 'id' in decoded)
				return decoded;
			throw new BadRequestException();
		} catch(error) {
			throw new BadRequestException('Token expired');
		}
	}

	async generateSecretQr(user: Player): Promise<string> {
		const { otpauth_url } = await this.generateTwoFactorAuthenticationSecret(user);
		const imageUrl = process.cwd() + "/public/qr_" + user.id + ".png";
		const pathToServe = "qr_" + user.id + ".png";
		QRCode.toFile(
			imageUrl,
			otpauth_url.toString(),
			[],
			(err, img) => {
					if (err) {
					  console.log('Error with QR');
					  return;
					}
				}
		  	)
		return pathToServe;
	}

	async setTwoFactorAuthenticationSecret(id:number , secret: string) {
		await this.userRepository.update(id, { secret: secret });
	}

	async turnOnTwoFactorAuthentication(id:number) {
		await this.userRepository.update(id, { two_fa: true });
		console.log('Two factor authentication turned on');
	}

	//----------------------------- TwoFactorAuthentication service.ts

	async generateTwoFactorAuthenticationSecret(user: Player) {

        const secret = authenticator.generateSecret();
		const token = authenticator.generate(secret);
        const otpauth_url = authenticator.keyuri(token, process.env.APP_NAME, secret);
        // await this.setTwoFactorAuthenticationSecret(user.id, secret);
		await this.userRepository.update(user.id, { secret: secret });
        return { secret, otpauth_url };
    }

	async verifyTwoFactorAuthenticationCodeValid(user: Player, code: string) {
		const secret = user.secret;
		const verif = authenticator.verify({token: code, secret: secret});
		console.log('verrified = ' + verif);
		return verif;
	}
}
