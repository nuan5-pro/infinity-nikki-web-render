import type { FurnitureABSFXCurrent } from '../materials/effects/absFxCurrentShader.js';
import type { FurnitureParallaxCard } from '../materials/effects/parallaxCardShader.js';
import type { FurnitureCharacterJewel } from '../materials/jewel/characterJewelShader.js';
import type { FurnitureIntStaticMeshCurrent } from '../materials/surface/intStaticMeshCurrentShader.js';

export function hasCharacterJewelAnimation(profile: FurnitureCharacterJewel) {
	const u = profile.uniforms;
	// The clock only enters the glint phase; zero speed, width or tint leaves it static.
	return u[11]![2] !== 0 && u[11]![1] !== 0 && u[15]!.slice(0, 3).some(value => value !== 0);
}

export function hasIntStaticMeshAnimation(profile: FurnitureIntStaticMeshCurrent) {
	if (profile.variant !== 'pattern-layer-glint') return false;

	const u = profile.uniforms;
	return u[19]![3] !== 0 && u[20]![0] !== 0 && u[19]![2] !== 0 && u[21]![2] !== 0;
}

export function hasParallaxCardAnimation(profile: FurnitureParallaxCard) {
	if (profile.version === 3) {
		const u = profile.current!.uniforms;
		return u[8]![1] !== 0 && (u[7]![3] !== 0 || u[8]![0] !== 0);
	}

	const s = profile.scalars;
	return s['Noise Intensity'] !== 0 && (s['X Noise Speed'] !== 0 || s['Y Noise Speed'] !== 0);
}

export function hasABSFXAnimation(profile: FurnitureABSFXCurrent) {
	// Normal alpha blending cannot display a zero collection-alpha material.
	if (profile.collection.baseColor[3] === 0) return false;

	const u = profile.uniforms;
	const glint = u[1]![1] !== 0 && (u[3]![3] !== 0 || u[34]![3] !== 0);
	const breath = u[36]![2] !== 0 && (u[37]![2] !== u[37]![3] || u[47]![1] !== u[47]![2]);
	const scrolling = [
		u[4]![1], u[4]![2], u[7]![3], u[8]![0], u[10]![1], u[10]![2],
		u[13]![2], u[13]![3], u[20]![2], u[20]![3], u[26]![0], u[26]![1],
		u[41]![3], u[42]![0],
	].some(value => value !== 0);
	return glint || breath || scrolling;
}
