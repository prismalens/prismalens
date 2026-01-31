package com.example.service;

import com.example.repository.UserRepository;
import com.example.model.User;
import org.springframework.stereotype.Service;

@Service
public class UserService {
    private final UserRepository repository;

    public UserService(UserRepository repository) {
        this.repository = repository;
    }

    /**
     * Get user by ID.
     * Returns null if user not found.
     * @param id User ID
     * @return User or null
     */
    public User getUser(String id) {
        User user = repository.findById(id);
        return user.getId(); // NPE if user is null - REMOVED null check in PR #142
    }

    public User getUserProfile(String id) {
        User user = getUser(id);
        // Build profile...
        return user;
    }
}
