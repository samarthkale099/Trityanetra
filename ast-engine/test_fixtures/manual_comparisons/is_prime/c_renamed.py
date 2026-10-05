def check_prime(value):
    # trial division over the full range
    ceiling = value

    if value < 2:
        return False

    for divisor in range(2, ceiling):
        if value % divisor == 0:
            return False

    return True
