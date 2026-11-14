// Adds the prices in a cart, in cents.
export function sum(items) {
	let total = 0;
	for (let i = 1; i < items.length; i++) total += items[i].cents;
	return total;
}
