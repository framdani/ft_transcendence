import { BadRequestException, Injectable, Request, Response } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Player } from '../players/player.entity';
import { UsersService } from '../players/players.service';
import { UserStatus } from '../players/player_status.enum';
import { JwtPayload } from './jwt-payload.interface';
const logout = require('express-passport-logout');
import * as dotenv from "dotenv";
dotenv.config({ path: `.env` });

const passport = require('passport');
const FortyTwoStrategy = require('passport-42').Strategy;

passport.use(new FortyTwoStrategy({

	clientID: process.env.UID,
	clientSecret: process.env.SECRET,
	callbackURL: process.env.CALLBACK_URL,
	},
	async function(accessToken: string, refreshToken: string, profile: any, cb: any) {
		const user = {
			id: profile._json.id,
			login: profile._json.login,
			// email: profile._json.email,
			accessToken: accessToken,
			refreshToken: refreshToken,
		}
		cb(null, user);
	}
));

@Injectable()
export class AuthService {
	constructor(
		private readonly playerService: UsersService,
		private jwtService: JwtService,
	) {}

	async login(
		@Request() req,
		@Response() res,
	) {
		console.log('login');
		passport.authenticate('42', {failureRedirect: "/"});
		if (!req.user) {
			return 'no user from 42';
		}
		const user = req.user;
		const player = await this.playerService.findOrCreate(user.id, user.login);
		// for (const [i, j] of Object.entries(player)) {
		// 	console.log(i, j);
		// }
		return this.cb(res, player);
	}

	async cb(
		@Response() res,
		player: Player
	) {
		const id = player.id;
		const username = player.username;
		const two_fa = player.two_fa;
		const payload: JwtPayload = { username, id, two_fa };
		const accessToken = await this.jwtService.sign(payload);
		if (player.two_fa == false) {
			if (player.status === UserStatus.OFFLINE)
				this.playerService.updateStatus(id, UserStatus.ONLINE);
			res.cookie('connect_sid',[accessToken]);
			res.redirect('http://localhost:3000/home');
		}
		else {
			console.log('two_fa');
			res.cookie('twofa',[accessToken]);
			res.redirect('http://localhost:3000/twofactorauthentication');
		}
	}

	async logout(id: number, req, res): Promise<any> {
		console.log('logout');
		const player = await this.playerService.getUserById(id);
		console.log(player.username + player.two_fa);
		await this.playerService.updateStatus(id, UserStatus.OFFLINE);
		await logout();
		await res.clearCookie('connect_sid', {domain: 'localhost', path: '/'});
		res.redirect('http://localhost:3000/home');
	}
}
