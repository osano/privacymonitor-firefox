function save_options() {
	let options = {};
	let elements = Array.prototype.slice.call(document.getElementsByTagName('select'));
		elements.forEach(function(e){
			options[e.id] = e.value;
		});
	browser.storage.sync.set(options)
	.then(function() {
		let status = document.getElementById('status');
		status.textContent = 'Options saved.';
		setTimeout(function() {
			status.textContent = '';
		}, 750);
	});
}

function restore_options() {
	let items = browser.storage.sync.get();
	items.then(function (items) {
		if(typeof(items.autoOption) == "undefined" || typeof(items.screenTime) == "undefined"){
			items = {
				autoOption: "auto",
				screenTime: "6"
			};
		}
		document.getElementById('autoOption').value = items.autoOption;
		document.getElementById('screenTime').value = items.screenTime;
	});
}

document.addEventListener('DOMContentLoaded', restore_options);
document.getElementById('save').addEventListener('click', save_options);