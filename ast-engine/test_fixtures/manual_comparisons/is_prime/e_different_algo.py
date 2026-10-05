def is_prime(n):
    if n < 2:
        return False
    if n < 4:
        return True
    return all(n % i != 0 for i in range(2, int(n ** 0.5) + 1))
