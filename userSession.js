// d:\Curso\POS 2025\userSession.js

let activeUserProfile = null;

export function setActiveUserProfile(profile) {
    activeUserProfile = profile;
}

export function getActiveUserProfile() {
    return activeUserProfile;
}

const sessionManager = {
    USERS_KEY: 'pos_auth_users',
    ACTIVE_USER_UID_KEY: 'pos_active_user_uid',

    getUsers: function() {
        try {
            const usersJson = localStorage.getItem(this.USERS_KEY);
            return usersJson ? JSON.parse(usersJson) : [];
        } catch (e) {
            console.error("Error parsing stored users", e);
            return [];
        }
    },
    storeUsers: function(users) {
        localStorage.setItem(this.USERS_KEY, JSON.stringify(users));
    },
    getActiveUserUID: function() {
        return sessionStorage.getItem(this.ACTIVE_USER_UID_KEY);
    },
    setActiveUser: function(uid) {
        sessionStorage.setItem(this.ACTIVE_USER_UID_KEY, uid);
    },
    getActiveUser: function() {
        const activeUID = this.getActiveUserUID();
        if (!activeUID) return null;
        const users = this.getUsers();
        return users.find(u => u.uid === activeUID) || null;
    },
    addUser: function(user) {
        const users = this.getUsers();
        const userIndex = users.findIndex(u => u.uid === user.uid);
        const userToStore = { uid: user.uid, email: user.email, displayName: user.displayName, photoURL: user.photoURL };
        if (userIndex === -1) { users.push(userToStore); } 
        else { users[userIndex] = userToStore; }
        this.storeUsers(users);
    },
    clearSession: function() {
        localStorage.removeItem(this.USERS_KEY);
        sessionStorage.removeItem(this.ACTIVE_USER_UID_KEY);
    }
};

export { sessionManager };